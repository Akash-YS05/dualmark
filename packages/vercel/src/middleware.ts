import { detectAIBot, estimateTokens, negotiateFormat, toMarkdownPath } from "@dualmark/core";
import type {
  AIRequestInfo,
  CreateAEOMiddlewareOptions,
  MinimalExecutionContext,
  MissInfo,
  VercelAnalyticsEvent,
  VercelEdgeMiddleware,
} from "./types.js";

const DEFAULT_SKIP_PREFIXES = ["/admin", "/api/", "/_"];
const DEFAULT_ASSET_EXTENSIONS = [
  ".js",
  ".css",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
  ".gif",
  ".ico",
  ".woff",
  ".woff2",
  ".xml",
  ".json",
  ".txt",
  ".pdf",
];

const DEFAULT_CACHE_CONTROL = "public, max-age=3600";

function shouldSkip(
  pathname: string,
  prefixes: ReadonlyArray<string>,
  extensions: ReadonlyArray<string>,
): boolean {
  if (extensions.some((ext) => pathname.endsWith(ext))) return true;
  return prefixes.some((prefix) => pathname.startsWith(prefix));
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/$/, "") || "/";
}

function appendVaryAccept(headers: Headers): void {
  const vary = headers.get("Vary");
  if (!vary) {
    headers.set("Vary", "Accept");
    return;
  }
  const tokens = vary.split(",").map((s) => s.trim().toLowerCase());
  if (!tokens.includes("accept")) {
    headers.set("Vary", `${vary}, Accept`);
  }
}

function buildMarkdownHeaders(
  body: string,
  cacheControl: string,
  redirectFrom?: string,
  redirectTo?: string,
): Headers {
  const tokens = estimateTokens(body);
  const headers = new Headers({
    "Content-Type": "text/markdown; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
    "X-Markdown-Tokens": String(tokens),
    "X-AEO-Version": "1.0",
    "Cache-Control": cacheControl,
    Vary: "Accept",
  });
  if (redirectFrom) headers.set("X-Redirect-From", redirectFrom);
  if (redirectTo) headers.set("X-Redirect-To", redirectTo);
  return headers;
}

function emitAnalytics(
  analytics: CreateAEOMiddlewareOptions["analytics"],
  request: Request,
  info: AIRequestInfo,
  kind: "hit" | "miss",
  ctx: MinimalExecutionContext,
): void {
  const onEvent = analytics?.onEvent;
  if (!onEvent) return;

  const indexKey = info.botName ?? "accept:text/markdown";
  const event: VercelAnalyticsEvent = {
    kind,
    indexKey,
    pathname: info.pathname,
    botName: info.botName,
    botVendor: info.botVendor,
    userAgent: (request.headers.get("user-agent") ?? "unknown").slice(0, 256),
    country: request.headers.get("x-vercel-ip-country") ?? "unknown",
    tokens: info.tokens,
    acceptHeader: info.acceptHeader,
  };
  ctx.waitUntil(Promise.resolve(onEvent(event)));
}

async function fetchMarkdownTwin(
  request: Request,
  mdPath: string,
  upstream: CreateAEOMiddlewareOptions["upstream"],
  ctx: MinimalExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);
  const mdUrl = new URL(mdPath + url.search, url.origin);
  const headers = new Headers(request.headers);
  headers.set("x-dualmark-internal", "1");

  try {
    return await upstream.fetch(
      new Request(mdUrl.toString(), {
        method: request.method,
        headers,
      }),
      ctx,
    );
  } catch {
    return null;
  }
}

async function serveMarkdownFromPath(
  request: Request,
  mdPath: string,
  upstream: CreateAEOMiddlewareOptions["upstream"],
  ctx: MinimalExecutionContext,
  cacheControl: string,
  redirectFrom?: string,
  redirectTo?: string,
): Promise<
  { response: Response; tokens: number; passthrough: boolean } | { missResponse: Response } | null
> {
  const mdResponse = await fetchMarkdownTwin(request, mdPath, upstream, ctx);
  if (!mdResponse) return null;

  if (mdResponse.headers.has("x-middleware-rewrite")) {
    return { response: mdResponse, tokens: 0, passthrough: true };
  }

  const contentType = (mdResponse.headers.get("content-type") ?? "").toLowerCase();
  if (!mdResponse.ok || !contentType.startsWith("text/markdown")) {
    return { missResponse: mdResponse };
  }

  const body = await mdResponse.text();
  const tokens = estimateTokens(body);
  return {
    response: new Response(body, {
      status: 200,
      headers: buildMarkdownHeaders(body, cacheControl, redirectFrom, redirectTo),
    }),
    tokens,
    passthrough: false,
  };
}

function isHitResult(
  result:
    | { response: Response; tokens: number; passthrough: boolean }
    | { missResponse: Response }
    | null,
): result is { response: Response; tokens: number; passthrough: boolean } {
  return Boolean(result && "response" in result);
}

function buildMissInfo(url: URL, botName: string | null, accept: string): MissInfo {
  return {
    url,
    botName,
    pathname: url.pathname,
    acceptHeader: accept,
  };
}

function makeInfo(
  url: URL,
  botName: string | null,
  botVendor: string | null,
  accept: string,
  cacheStatus: "hit" | "miss",
  tokens: number,
): AIRequestInfo {
  return {
    url,
    botName,
    botVendor,
    acceptHeader: accept,
    pathname: url.pathname,
    cacheStatus,
    tokens,
  };
}

export function createAEOMiddleware(options: CreateAEOMiddlewareOptions): VercelEdgeMiddleware {
  const skipPrefixes = options.skip?.prefixes ?? DEFAULT_SKIP_PREFIXES;
  const skipExtensions = options.skip?.extensions ?? DEFAULT_ASSET_EXTENSIONS;
  const internalRedirects = options.redirects?.internal ?? {};
  const externalRedirects = options.redirects?.external ?? {};
  const trailingSlash = options.trailingSlash ?? "never";
  const cacheControl = options.headers?.cacheControl ?? DEFAULT_CACHE_CONTROL;
  const enableLinkHeader = options.enableLinkHeader !== false;
  const onAIRequest = options.hooks?.onAIRequest;
  const onMiss = options.hooks?.onMiss;

  return async function middleware(request, event): Promise<Response> {
    const ctx: MinimalExecutionContext = {
      waitUntil: (promise) => {
        event?.waitUntil?.(promise);
      },
    };

    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.headers.get("x-dualmark-internal") === "1") {
      return options.upstream.fetch(request, ctx);
    }

    if (
      trailingSlash === "never" &&
      pathname !== "/" &&
      pathname.endsWith("/") &&
      !shouldSkip(pathname, skipPrefixes, skipExtensions)
    ) {
      const clean = pathname.replace(/\/+$/, "");
      return Response.redirect(new URL(clean + url.search, url.origin), 301);
    }

    if (
      trailingSlash === "always" &&
      pathname !== "/" &&
      !pathname.endsWith("/") &&
      !pathname.endsWith(".md") &&
      !shouldSkip(pathname, skipPrefixes, skipExtensions)
    ) {
      return Response.redirect(new URL(pathname + "/" + url.search, url.origin), 301);
    }

    if (pathname.endsWith(".md") && !shouldSkip(pathname, skipPrefixes, skipExtensions)) {
      const markdown = await serveMarkdownFromPath(
        request,
        pathname,
        options.upstream,
        ctx,
        cacheControl,
      );
      if (markdown) {
        return isHitResult(markdown) ? markdown.response : markdown.missResponse;
      }
    }

    if (!pathname.endsWith(".md") && !shouldSkip(pathname, skipPrefixes, skipExtensions)) {
      const ua = request.headers.get("user-agent") ?? "";
      const accept = request.headers.get("accept") ?? "";
      const bot = detectAIBot(ua);
      const format = negotiateFormat(accept);

      if (format === null && accept) {
        return new Response("Not Acceptable\n\nSupported types: text/html, text/markdown\n", {
          status: 406,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            Vary: "Accept",
          },
        });
      }

      const shouldServeMarkdown = bot.isBot || format === "markdown";
      if (shouldServeMarkdown) {
        const mdPath = toMarkdownPath(pathname);
        const markdown = await serveMarkdownFromPath(
          request,
          mdPath,
          options.upstream,
          ctx,
          cacheControl,
        );

        if (isHitResult(markdown)) {
          if (markdown.passthrough) return markdown.response;
          const info = makeInfo(url, bot.name, bot.vendor, accept, "hit", markdown.tokens);
          emitAnalytics(options.analytics, request, info, "hit", ctx);
          if (onAIRequest) ctx.waitUntil(Promise.resolve(onAIRequest(info)));
          return markdown.response;
        }

        const cleanPath = normalizePath(pathname);
        const internalTarget = internalRedirects[cleanPath];
        if (internalTarget) {
          const internalMdPath = toMarkdownPath(internalTarget);
          const internalMarkdown = await serveMarkdownFromPath(
            request,
            internalMdPath,
            options.upstream,
            ctx,
            cacheControl,
            cleanPath,
            internalTarget,
          );

          if (isHitResult(internalMarkdown)) {
            if (internalMarkdown.passthrough) return internalMarkdown.response;
            const info = makeInfo(
              url,
              bot.name,
              bot.vendor,
              accept,
              "hit",
              internalMarkdown.tokens,
            );
            emitAnalytics(options.analytics, request, info, "hit", ctx);
            if (onAIRequest) ctx.waitUntil(Promise.resolve(onAIRequest(info)));
            return internalMarkdown.response;
          }
        }

        const externalTarget = externalRedirects[cleanPath];
        if (externalTarget) {
          const body = `# Redirect\n\nThis page has moved to an external location.\n\n- **Redirect**: [${externalTarget}](${externalTarget})\n`;
          const info = makeInfo(url, bot.name, bot.vendor, accept, "hit", estimateTokens(body));
          emitAnalytics(options.analytics, request, info, "hit", ctx);
          if (onAIRequest) ctx.waitUntil(Promise.resolve(onAIRequest(info)));
          return new Response(body, {
            status: 200,
            headers: buildMarkdownHeaders(body, cacheControl, cleanPath, externalTarget),
          });
        }

        const missInfo = buildMissInfo(url, bot.name, accept);
        const missAnalytics = makeInfo(url, bot.name, bot.vendor, accept, "miss", 0);
        emitAnalytics(options.analytics, request, missAnalytics, "miss", ctx);
        if (onMiss) ctx.waitUntil(Promise.resolve(onMiss(missInfo)));
      }
    }

    const upstreamResponse = await options.upstream.fetch(request, ctx);

    const contentType = upstreamResponse.headers.get("content-type")?.toLowerCase() ?? "";
    const isNextPassThrough = upstreamResponse.headers.has("x-middleware-next");

    if (
      enableLinkHeader &&
      !shouldSkip(pathname, skipPrefixes, skipExtensions) &&
      !pathname.endsWith(".md") &&
      (contentType.includes("text/html") || isNextPassThrough)
    ) {
      const mdPath = toMarkdownPath(pathname);
      const link = `<${mdPath}>; rel="alternate"; type="text/markdown"`;
      const existingLink = upstreamResponse.headers.get("Link");

      if (isNextPassThrough) {
        upstreamResponse.headers.set("Link", existingLink ? `${existingLink}, ${link}` : link);
        appendVaryAccept(upstreamResponse.headers);
        return upstreamResponse;
      }

      const headers = new Headers(upstreamResponse.headers);
      headers.set("Link", existingLink ? `${existingLink}, ${link}` : link);
      appendVaryAccept(headers);

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers,
      });
    }

    return upstreamResponse;
  };
}
