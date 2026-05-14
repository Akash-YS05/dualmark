import { renderLlmsTxt } from "@dualmark/core";

const SITE_URL = "https://vercel.dualmark.dev";

export const dynamic = "force-static";

export async function GET(): Promise<Response> {
  const body = renderLlmsTxt({
    brandName: "Dualmark Vercel Edge Example",
    description: "Reference implementation of Dualmark on Vercel Edge middleware.",
    sections: [
      {
        title: "Pages",
        links: [
          { title: "Home", href: `${SITE_URL}/` },
          { title: "Posts", href: `${SITE_URL}/posts` },
          { title: "Hello Post", href: `${SITE_URL}/posts/hello` },
          { title: "Negotiation Post", href: `${SITE_URL}/posts/negotiation` },
        ],
      },
    ],
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
