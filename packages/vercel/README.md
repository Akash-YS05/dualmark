# @dualmark/vercel

Vercel Edge Middleware adapter for the Dualmark AEO framework. Wrap any upstream edge middleware and transparently serve markdown to AI bots.

## Install

```bash
bun add @dualmark/vercel @dualmark/core
```

## Usage

```ts
import { createAEOMiddleware } from "@dualmark/vercel";

async function upstreamFetch(request: Request): Promise<Response> {
  return fetch(request);
}

export default createAEOMiddleware({
  upstream: {
    fetch: (request) => upstreamFetch(request),
  },

  redirects: {
    internal: { "/old-path": "/new-path" },
    external: { "/login": "https://app.example.com" },
  },

  trailingSlash: "never",

  analytics: {
    onEvent: (event) => {
      console.log(`${event.kind} bot=${event.botName ?? "?"} path=${event.pathname}`);
    },
  },

  hooks: {
    onAIRequest: (info) => console.log(`${info.botName} hit ${info.pathname}`),
    onMiss: (info) => console.warn(`miss: ${info.pathname}`),
  },
});
```

## What it does

1. Trailing-slash enforcement (configurable: `never`, `always`, `preserve`)
2. AI bot detection via UA
3. Content negotiation via Accept header
4. Serves pre-built `.md` twins through upstream middleware with full AEO headers
5. Internal redirects: routes to target's `.md`
6. External redirects: returns markdown notice
7. 406 when neither HTML nor markdown is acceptable
8. Link header injection (`<...>; rel="alternate"; type="text/markdown"`) on HTML responses
9. Optional analytics hook for hit/miss telemetry (can forward to Vercel Analytics or OpenTelemetry)
10. Falls through to upstream middleware for everything else

## License

Apache 2.0
