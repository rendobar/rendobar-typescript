# Examples

## Projects

Each project installs the packages the way a user does, from `npm pack` tarballs, and type-checks with `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.

| Project | What it does |
|---|---|
| [`nestjs-app`](nestjs-app) | A NestJS app on `@rendobar/nestjs`: an endpoint that probes a video and returns the typed result, and a webhook route that verifies and handles each event |
| [`agent-toolkit-ai-sdk`](agent-toolkit-ai-sdk) | An AI SDK agent on `@rendobar/agent-toolkit` that probes a video, trims it to 2 seconds and answers with the URL, driven by a scripted model |

This repository holds the framework packages, not the SDK, so the SDK's own example set (quickstart, uploads, batch worker, account admin, realtime) lives in the SDK's repository. Neither package uploads files, so these projects need no media fixture: they read a public sample video.

### Run them

```bash
pnpm install
# Mock mode: start the conformance mock from rendobar/openapi first.
python3 -I .openapi/conformance/mock_server.py .openapi/openapi.json 4100 requests.jsonl &
node examples/run.mjs --mode mock
# Live mode: a real API. Costs four ffprobe jobs and one 2-second ffmpeg job.
RENDOBAR_API_URL=https://api-staging.rendobar.com RENDOBAR_API_KEY=rb_... node examples/run.mjs --mode live
```

Name projects after the flags to run only those. `run.mjs` builds and packs each package, copies the project to a temp folder, installs it there and runs its `npm test`. Set `RENDOBAR_SDK_TARBALL` to a local `@rendobar/sdk` tarball to test against an SDK that is not on npm yet. In mock mode, a step the mock cannot answer for real prints `SKIP (mock: <why>)` and runs in live mode.

### CI

- `ci.yml`, job `examples`: every pull request runs the projects in mock mode.
- `examples-live.yml`: on demand and every Monday at 06:00 UTC, in live mode, with the `RENDOBAR_STAGING_API_URL` and `RENDOBAR_STAGING_API_KEY` secrets.
- `release.yml`: the live run must pass before a package publishes.

All three install `@rendobar/sdk` from npm through the `^5.18.0` range, as the packages' own CI does. Until 5.18.0 is published and the lockfile committed, they fail at install, like the rest of CI. They need no edit once it is.

## Web frameworks

Rendobar in three web frameworks, in this folder's own `src/`. Each one submits a job from a route and verifies Rendobar's webhook, and each runs in CI against the conformance mock with `pnpm test`.

| Framework | File |
|---|---|
| Next.js (App Router) | [`src/nextjs/app/api/`](src/nextjs/app/api) |
| Express | [`src/express.ts`](src/express.ts) |
| Hono (Node, Workers, Bun, Deno) | [`src/hono.ts`](src/hono.ts) |

Set `RENDOBAR_API_KEY` and `RENDOBAR_WEBHOOK_SECRET` to run them against the API.
