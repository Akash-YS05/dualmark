# dualmark-example-vercel-edge-full

Production-grade reference: a Next.js site on Vercel Edge middleware, with `@dualmark/vercel` wrapping upstream fetch so AI bots get markdown twins at the edge.

## Architecture

```
proxy.ts
  createAEOMiddleware({ upstream })
    - AI bot UA / Accept: text/markdown -> serve markdown
    - direct .md -> serve markdown twin
    - browser HTML -> pass through + Link rel=alternate

app/md/[...path]/route.ts
  markdown source route used by the edge adapter upstream
```

## Run

```bash
bun install
bun run dev
```

## Run with Vercel Edge locally

```bash
bun run vercel:dev
```

## Verify

In one terminal:

```bash
bun run dev
```

In another:

```bash
bun run verify
```

Expected score: **120/125 or higher**.

## License

Apache 2.0
