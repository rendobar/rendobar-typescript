# Examples

Rendobar in three web frameworks. Each one submits a job from a route and verifies Rendobar's webhook, and each runs in CI against the conformance mock, so none of them can quietly go stale.

| Framework | File |
|---|---|
| Next.js (App Router) | [`src/nextjs/app/api/`](src/nextjs/app/api) |
| Express | [`src/express.ts`](src/express.ts) |
| Hono (Node, Workers, Bun, Deno) | [`src/hono.ts`](src/hono.ts) |

Set `RENDOBAR_API_KEY` and `RENDOBAR_WEBHOOK_SECRET` to run them against the API.
