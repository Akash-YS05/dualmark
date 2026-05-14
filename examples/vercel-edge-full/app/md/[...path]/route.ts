import { markdownResponse } from "@dualmark/core";
import { POSTS } from "@/lib/posts";

const SITE_URL = "https://vercel.dualmark.dev";

function renderHome(): string {
  return `# Dualmark Vercel Edge Example

> Reference implementation of Dualmark on Vercel Edge middleware.

A minimal site demonstrating the \`@dualmark/vercel\` adapter.

## Posts

- [Hello from Vercel Edge + Dualmark](/posts/hello)
- [How content negotiation works](/posts/negotiation)
`;
}

function renderPostsListing(): string {
  const items = POSTS.map((post) => `- [${post.title}](/posts/${post.slug})`).join("\n");
  return `# Posts

All posts on the Dualmark Vercel example.

${items}
`;
}

function renderPost(slug: string): string | null {
  const post = POSTS.find((p) => p.slug === slug);
  if (!post) return null;
  return `# ${post.title}

${post.description}

- Author: ${post.author}
- Published: ${post.publishedDate}
- Category: ${post.category}
- Canonical: ${SITE_URL}/posts/${post.slug}

${post.body}
`;
}

export const dynamic = "force-static";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const params = await ctx.params;
  const path = params.path ?? [];
  const joined = "/" + path.join("/");

  if (joined === "/index" || joined === "/") {
    return markdownResponse(renderHome());
  }

  if (joined === "/posts") {
    return markdownResponse(renderPostsListing());
  }

  if (joined.startsWith("/posts/")) {
    const slug = joined.slice("/posts/".length);
    if (slug.length === 0) return new Response("Not Found", { status: 404 });
    const md = renderPost(slug);
    if (!md) return new Response("Not Found", { status: 404 });
    return markdownResponse(md);
  }

  return new Response("Not Found", { status: 404 });
}

export async function generateStaticParams(): Promise<Array<{ path: string[] }>> {
  return [
    { path: ["index"] },
    { path: ["posts"] },
    ...POSTS.map((post) => ({ path: ["posts", post.slug] })),
  ];
}
