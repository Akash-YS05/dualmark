---
"@dualmark/vercel": minor
---

Add Vercel Edge Middleware adapter. Exports `createAEOMiddleware({ upstream, trailingSlash, analytics })` using the Web Fetch API (no Node runtime deps). Analytics uses an optional hook model (`analytics.onEvent`) suitable for Vercel Analytics or OpenTelemetry. Shares the negotiation test suite with `@dualmark/cloudflare`.
