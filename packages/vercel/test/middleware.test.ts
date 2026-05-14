import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAEOMiddleware } from "../src/index.js";
import { runNegotiationSuite } from "../../cloudflare/test/negotiation-suite.js";
import type {
  MinimalExecutionContext,
  UpstreamMiddleware,
  VercelAnalyticsEvent,
} from "../src/types.js";

function makeUpstream(
  handler: (req: Request, ctx: MinimalExecutionContext) => Response | Promise<Response>,
): UpstreamMiddleware {
  return {
    fetch: async (req, ctx) => handler(req, ctx),
  };
}

function makeCtx(): MinimalExecutionContext {
  const promises: Promise<unknown>[] = [];
  return {
    waitUntil: (p) => {
      promises.push(p);
    },
  };
}

function makeApp(files: Record<string, string>): UpstreamMiddleware {
  return makeUpstream(async (req) => {
    const url = new URL(req.url);
    const body = files[url.pathname];
    if (body === undefined) return new Response("Not found", { status: 404 });
    if (url.pathname.endsWith(".md")) {
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    }
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  });
}

describe("createAEOMiddleware - markdown serving", () => {
  let upstream: UpstreamMiddleware;

  beforeEach(() => {
    upstream = makeApp({
      "/blog/post-1": "<html><body>Post</body></html>",
      "/blog/post-1.md": "# Post 1\n\nBody.",
      "/": "<html><body>Home</body></html>",
      "/index.md": "# Home\n\nWelcome.",
    });
  });

  it("serves markdown to AI bot UA on existing path", async () => {
    const mw = createAEOMiddleware({ upstream });
    const req = new Request("https://acme.test/blog/post-1", {
      headers: { "user-agent": "GPTBot/1.0" },
    });
    const res = await mw(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("x-markdown-tokens")).toBe("4");
    expect(res.headers.get("x-aeo-version")).toBe("1.0");
    expect(res.headers.get("vary")).toBe("Accept");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(await res.text()).toBe("# Post 1\n\nBody.");
  });

  it("serves markdown when Accept: text/markdown (no bot UA)", async () => {
    const mw = createAEOMiddleware({ upstream });
    const req = new Request("https://acme.test/blog/post-1", {
      headers: { accept: "text/markdown" },
    });
    const res = await mw(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
  });

  it("returns 406 when Accept rules out html and markdown", async () => {
    const mw = createAEOMiddleware({ upstream });
    const req = new Request("https://acme.test/blog/post-1", {
      headers: { accept: "image/png" },
    });
    const res = await mw(req);
    expect(res.status).toBe(406);
    expect(res.headers.get("vary")).toBe("Accept");
  });

  it("falls through to upstream for browser UA", async () => {
    const upstreamMock = vi.fn(
      (_req: Request, _ctx: MinimalExecutionContext) =>
        new Response("<html>x</html>", { headers: { "Content-Type": "text/html" } }),
    );
    const mw = createAEOMiddleware({
      upstream: { fetch: async (req, ctx) => upstreamMock(req, ctx) },
    });
    const req = new Request("https://acme.test/blog/post-1", {
      headers: {
        "user-agent": "Mozilla/5.0 Chrome/130",
        accept: "text/html,*/*;q=0.8",
      },
    });
    const res = await mw(req);
    expect(upstreamMock).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    const link = res.headers.get("link") ?? "";
    expect(link).toContain('</blog/post-1.md>; rel="alternate"; type="text/markdown"');
    expect(res.headers.get("vary")).toContain("Accept");
  });

  it("handles missing .md (cache miss) for bot - falls to upstream", async () => {
    const upstreamMock = vi.fn(
      (_req: Request, _ctx: MinimalExecutionContext) =>
        new Response("<html>404</html>", {
          status: 404,
          headers: { "Content-Type": "text/html" },
        }),
    );
    const mw = createAEOMiddleware({
      upstream: { fetch: async (req, ctx) => upstreamMock(req, ctx) },
    });
    const req = new Request("https://acme.test/blog/missing", {
      headers: { "user-agent": "GPTBot/1.0" },
    });
    const res = await mw(req);
    expect(upstreamMock).toHaveBeenCalledTimes(2);
    const firstReq = upstreamMock.mock.calls[0]?.[0] as Request;
    const secondReq = upstreamMock.mock.calls[1]?.[0] as Request;
    expect(new URL(firstReq.url).pathname).toBe("/blog/missing.md");
    expect(new URL(secondReq.url).pathname).toBe("/blog/missing");
    expect(res.status).toBe(404);
  });

  it("serves index.md for root path", async () => {
    const mw = createAEOMiddleware({ upstream });
    const req = new Request("https://acme.test/", {
      headers: { "user-agent": "GPTBot/1.0" },
    });
    const res = await mw(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("# Home\n\nWelcome.");
  });

  it("decorates direct .md requests with full AEO headers", async () => {
    const mw = createAEOMiddleware({ upstream });
    const req = new Request("https://acme.test/blog/post-1.md");
    const res = await mw(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("X-Markdown-Tokens")).toMatch(/^\d+$/);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(res.headers.get("Vary")).toBe("Accept");
    expect(res.headers.get("X-AEO-Version")).toBe("1.0");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res.text()).toBe("# Post 1\n\nBody.");
  });

  it("returns 404 for direct .md request when asset missing", async () => {
    const mw = createAEOMiddleware({ upstream });
    const req = new Request("https://acme.test/missing.md");
    const res = await mw(req);
    expect(res.status).toBe(404);
  });
});

describe("createAEOMiddleware - trailing slash", () => {
  it("redirects /path/ -> /path with 301 by default", async () => {
    const mw = createAEOMiddleware({ upstream: makeUpstream(() => new Response("ok")) });
    const req = new Request("https://acme.test/blog/");
    const res = await mw(req);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://acme.test/blog");
  });

  it("preserves trailing slash with mode=preserve", async () => {
    const upstreamMock = vi.fn(
      (_req: Request, _ctx: MinimalExecutionContext) =>
        new Response("ok", { headers: { "Content-Type": "text/html" } }),
    );
    const mw = createAEOMiddleware({
      upstream: { fetch: async (req, ctx) => upstreamMock(req, ctx) },
      trailingSlash: "preserve",
    });
    const req = new Request("https://acme.test/blog/");
    const res = await mw(req);
    expect(res.status).toBe(200);
    expect(upstreamMock).toHaveBeenCalledOnce();
  });

  it("redirects /path -> /path/ with mode=always", async () => {
    const mw = createAEOMiddleware({
      upstream: makeUpstream(() => new Response("ok")),
      trailingSlash: "always",
    });
    const req = new Request("https://acme.test/blog");
    const res = await mw(req);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://acme.test/blog/");
  });
});

describe("createAEOMiddleware - redirects", () => {
  let upstream: UpstreamMiddleware;

  beforeEach(() => {
    upstream = makeApp({
      "/new-path": "<html>new</html>",
      "/new-path.md": "# New\n\nMoved.",
    });
  });

  it("follows internal redirect for AI bot to canonical .md", async () => {
    const mw = createAEOMiddleware({
      upstream,
      redirects: { internal: { "/old-path": "/new-path" } },
    });
    const req = new Request("https://acme.test/old-path", {
      headers: { "user-agent": "GPTBot/1.0" },
    });
    const res = await mw(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-redirect-from")).toBe("/old-path");
    expect(res.headers.get("x-redirect-to")).toBe("/new-path");
    expect(await res.text()).toContain("# New");
  });

  it("returns markdown notice for external redirect", async () => {
    const mw = createAEOMiddleware({
      upstream,
      redirects: { external: { "/login": "https://app.example.com" } },
    });
    const req = new Request("https://acme.test/login", {
      headers: { "user-agent": "GPTBot/1.0" },
    });
    const res = await mw(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("x-redirect-to")).toBe("https://app.example.com");
    expect(await res.text()).toContain("https://app.example.com");
  });
});

describe("createAEOMiddleware - skip rules", () => {
  it("skips /api/ paths entirely", async () => {
    const upstreamMock = vi.fn(
      (_req: Request, _ctx: MinimalExecutionContext) => new Response("api"),
    );
    const mw = createAEOMiddleware({
      upstream: { fetch: async (req, ctx) => upstreamMock(req, ctx) },
    });
    const req = new Request("https://acme.test/api/foo", {
      headers: { "user-agent": "GPTBot/1.0" },
    });
    const res = await mw(req);
    expect(upstreamMock).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
  });

  it("skips asset extensions", async () => {
    const upstreamMock = vi.fn(
      (_req: Request, _ctx: MinimalExecutionContext) =>
        new Response(".css", { headers: { "Content-Type": "text/css" } }),
    );
    const mw = createAEOMiddleware({
      upstream: { fetch: async (req, ctx) => upstreamMock(req, ctx) },
    });
    const req = new Request("https://acme.test/style.css", {
      headers: { "user-agent": "GPTBot/1.0" },
    });
    await mw(req);
    expect(upstreamMock).toHaveBeenCalledOnce();
  });

  it("does not inject Link header on non-html responses", async () => {
    const mw = createAEOMiddleware({
      upstream: makeUpstream(
        () => new Response("{}", { headers: { "Content-Type": "application/json" } }),
      ),
    });
    const req = new Request("https://acme.test/data");
    const res = await mw(req);
    expect(res.headers.get("link")).toBeNull();
  });
});

describe("createAEOMiddleware - analytics", () => {
  it("emits hit event when analytics hook present", async () => {
    const events: VercelAnalyticsEvent[] = [];
    const mw = createAEOMiddleware({
      upstream: makeApp({
        "/x": "<html>X</html>",
        "/x.md": "# X",
      }),
      analytics: {
        onEvent: (event) => {
          events.push(event);
        },
      },
    });

    await mw(
      new Request("https://acme.test/x", {
        headers: {
          "user-agent": "GPTBot/1.0",
          "x-vercel-ip-country": "IN",
        },
      }),
      { waitUntil: (_p) => {} },
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("hit");
    expect(events[0]?.indexKey).toBe("GPTBot");
    expect(events[0]?.pathname).toBe("/x");
    expect(events[0]?.country).toBe("IN");
    expect(events[0]?.tokens).toBeGreaterThan(0);
  });

  it("emits miss event when markdown twin does not exist", async () => {
    const events: VercelAnalyticsEvent[] = [];
    const mw = createAEOMiddleware({
      upstream: makeUpstream(() => new Response("404", { status: 404 })),
      analytics: {
        onEvent: (event) => {
          events.push(event);
        },
      },
    });

    await mw(
      new Request("https://acme.test/missing", {
        headers: { "user-agent": "GPTBot/1.0" },
      }),
      { waitUntil: (_p) => {} },
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("miss");
    expect(events[0]?.tokens).toBe(0);
  });

  it("does not throw when analytics is absent", async () => {
    const mw = createAEOMiddleware({
      upstream: makeApp({
        "/x": "<html>X</html>",
        "/x.md": "# X",
      }),
    });
    const res = await mw(
      new Request("https://acme.test/x", { headers: { "user-agent": "GPTBot/1.0" } }),
      { waitUntil: (_p) => {} },
    );
    expect(res.status).toBe(200);
  });
});

describe("createAEOMiddleware - hooks", () => {
  it("calls onAIRequest on hit", async () => {
    const onAIRequest = vi.fn();
    const mw = createAEOMiddleware({
      upstream: makeApp({
        "/p": "<html>p</html>",
        "/p.md": "# p",
      }),
      hooks: { onAIRequest },
    });
    await mw(new Request("https://acme.test/p", { headers: { "user-agent": "GPTBot/1.0" } }), {
      waitUntil: (_p) => {},
    });
    expect(onAIRequest).toHaveBeenCalledOnce();
    const info = onAIRequest.mock.calls[0]?.[0];
    expect(info.botName).toBe("GPTBot");
    expect(info.cacheStatus).toBe("hit");
  });

  it("calls onMiss on cache miss", async () => {
    const onMiss = vi.fn();
    const mw = createAEOMiddleware({
      upstream: makeUpstream(() => new Response("404", { status: 404 })),
      hooks: { onMiss },
    });
    await mw(new Request("https://acme.test/q", { headers: { "user-agent": "GPTBot/1.0" } }), {
      waitUntil: (_p) => {},
    });
    expect(onMiss).toHaveBeenCalledOnce();
  });
});

describe("createAEOMiddleware - Link header injection", () => {
  it("preserves existing Link header values", async () => {
    const mw = createAEOMiddleware({
      upstream: makeUpstream(
        () =>
          new Response("<html></html>", {
            headers: {
              "Content-Type": "text/html",
              Link: "</style.css>; rel=preload; as=style",
            },
          }),
      ),
    });
    const res = await mw(new Request("https://acme.test/page"));
    const link = res.headers.get("link") ?? "";
    expect(link).toContain("</style.css>; rel=preload; as=style");
    expect(link).toContain('</page.md>; rel="alternate"; type="text/markdown"');
  });

  it("can be disabled via enableLinkHeader=false", async () => {
    const mw = createAEOMiddleware({
      upstream: makeUpstream(
        () => new Response("<html></html>", { headers: { "Content-Type": "text/html" } }),
      ),
      enableLinkHeader: false,
    });
    const res = await mw(new Request("https://acme.test/page"));
    expect(res.headers.get("link")).toBeNull();
  });
});

describe("createAEOMiddleware - event waitUntil passthrough", () => {
  it("uses provided event.waitUntil for async hooks", async () => {
    const waitUntil = vi.fn();
    const onAIRequest = vi.fn(async () => undefined);

    const mw = createAEOMiddleware({
      upstream: makeApp({
        "/x": "<html>X</html>",
        "/x.md": "# X",
      }),
      hooks: { onAIRequest },
    });

    await mw(new Request("https://acme.test/x", { headers: { "user-agent": "GPTBot/1.0" } }), {
      waitUntil,
    });

    expect(onAIRequest).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledOnce();
  });

  it("allows running without event argument", async () => {
    const mw = createAEOMiddleware({
      upstream: makeApp({
        "/x": "<html>X</html>",
        "/x.md": "# X",
      }),
      hooks: { onAIRequest: async () => undefined },
    });

    const res = await mw(
      new Request("https://acme.test/x", { headers: { "user-agent": "GPTBot/1.0" } }),
    );
    expect(res.status).toBe(200);
  });
});

runNegotiationSuite("createAEOMiddleware — negotiation suite", {
  create: ({ markdownFiles = {}, htmlFiles = {}, upstream404 = false, options = {} }) => {
    const upstream = makeUpstream(async (req) => {
      const url = new URL(req.url);
      const body = markdownFiles[url.pathname];
      if (body !== undefined) {
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        });
      }

      const html = htmlFiles[url.pathname];
      if (html !== undefined) {
        return new Response(html, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (upstream404) {
        return new Response("Not found", {
          status: 404,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return new Response("ok", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    });

    const mw = createAEOMiddleware({
      upstream,
      redirects: options.redirects,
      trailingSlash: options.trailingSlash,
      enableLinkHeader: options.enableLinkHeader,
    });

    return {
      handle: async (request: Request) => mw(request),
    };
  },
});
