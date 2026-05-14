import { createAEOMiddleware } from "@dualmark/vercel";
import { NextResponse } from "next/server";

function rewriteMarkdownPath(pathname: string): string {
  const stripped = pathname.replace(/\.md$/, "").replace(/\/+$/, "");
  if (stripped === "" || stripped === "/") return "/md/index";
  return `/md${stripped}`;
}

export default createAEOMiddleware({
  upstream: {
    fetch: async (request) => {
      const url = new URL(request.url);
      const pathname = url.pathname;

      if (pathname.startsWith("/md/") || pathname === "/llms.txt") {
        return NextResponse.next();
      }

      if (pathname.endsWith(".md")) {
        const rewriteUrl = new URL(request.url);
        rewriteUrl.pathname = rewriteMarkdownPath(pathname);
        return NextResponse.rewrite(rewriteUrl);
      }

      const fetchHeaders = new Headers(request.headers);
      fetchHeaders.set("x-middleware-subrequest", "middleware");
      return fetch(url.toString(), { headers: fetchHeaders });
    },
  },
  trailingSlash: "never",
  analytics: {
    onEvent: async (_event) => {
      return;
    },
  },
});

export const config = {
  matcher: [
    {
      source: "/((?!_next/|favicon.ico).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
