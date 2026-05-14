import { describe, expect, it } from "vitest";

export interface NegotiationSuiteOptions {
  redirects?: {
    internal?: Record<string, string>;
    external?: Record<string, string>;
  };
  trailingSlash?: "never" | "always" | "preserve";
  enableLinkHeader?: boolean;
}

export interface NegotiationSuiteHarness {
  create: (args: {
    markdownFiles?: Record<string, string>;
    htmlFiles?: Record<string, string>;
    upstream404?: boolean;
    options?: NegotiationSuiteOptions;
  }) => {
    handle: (request: Request) => Promise<Response>;
  };
}

export function runNegotiationSuite(name: string, harness: NegotiationSuiteHarness): void {
  describe(name, () => {
    it("serves markdown for AI bot UA", async () => {
      const app = harness.create({
        markdownFiles: { "/blog/post-1.md": "# Post 1\n\nBody." },
        htmlFiles: { "/blog/post-1": "<html>Post</html>" },
      });
      const res = await app.handle(
        new Request("https://acme.test/blog/post-1", {
          headers: { "user-agent": "GPTBot/1.0" },
        }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
      expect(res.headers.get("vary")).toContain("Accept");
    });

    it("serves markdown for Accept: text/markdown", async () => {
      const app = harness.create({
        markdownFiles: { "/blog/post-1.md": "# Post 1\n\nBody." },
        htmlFiles: { "/blog/post-1": "<html>Post</html>" },
      });
      const res = await app.handle(
        new Request("https://acme.test/blog/post-1", {
          headers: { accept: "text/markdown" },
        }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    });

    it("returns 406 for unacceptable Accept header", async () => {
      const app = harness.create({
        markdownFiles: { "/blog/post-1.md": "# Post 1\n\nBody." },
        htmlFiles: { "/blog/post-1": "<html>Post</html>" },
      });
      const res = await app.handle(
        new Request("https://acme.test/blog/post-1", {
          headers: { accept: "image/png" },
        }),
      );
      expect(res.status).toBe(406);
      expect(res.headers.get("vary")).toBe("Accept");
    });

    it("injects Link alternate on html response", async () => {
      const app = harness.create({
        markdownFiles: { "/blog/post-1.md": "# Post 1\n\nBody." },
        htmlFiles: { "/blog/post-1": "<html>Post</html>" },
      });
      const res = await app.handle(
        new Request("https://acme.test/blog/post-1", {
          headers: {
            "user-agent": "Mozilla/5.0 Chrome/130",
            accept: "text/html,*/*;q=0.8",
          },
        }),
      );
      expect(res.status).toBe(200);
      const link = res.headers.get("link") ?? "";
      expect(link).toContain('</blog/post-1.md>; rel="alternate"; type="text/markdown"');
      expect(res.headers.get("vary")).toContain("Accept");
    });

    it("supports internal redirect markdown mapping", async () => {
      const app = harness.create({
        markdownFiles: { "/new-path.md": "# New\n\nMoved." },
        options: { redirects: { internal: { "/old-path": "/new-path" } } },
      });
      const res = await app.handle(
        new Request("https://acme.test/old-path", {
          headers: { "user-agent": "GPTBot/1.0" },
        }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("x-redirect-from")).toBe("/old-path");
      expect(res.headers.get("x-redirect-to")).toBe("/new-path");
    });

    it("returns external redirect notice markdown", async () => {
      const app = harness.create({
        options: { redirects: { external: { "/login": "https://app.example.com" } } },
      });
      const res = await app.handle(
        new Request("https://acme.test/login", {
          headers: { "user-agent": "GPTBot/1.0" },
        }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
      expect(await res.text()).toContain("https://app.example.com");
    });

    it("applies trailingSlash=never redirect", async () => {
      const app = harness.create({
        options: { trailingSlash: "never" },
      });
      const res = await app.handle(new Request("https://acme.test/blog/"));
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("https://acme.test/blog");
    });

    it("applies trailingSlash=always redirect", async () => {
      const app = harness.create({
        options: { trailingSlash: "always" },
      });
      const res = await app.handle(new Request("https://acme.test/blog"));
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("https://acme.test/blog/");
    });
  });
}
