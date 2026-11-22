# NestJS app with @rendobar/nestjs

A small NestJS app with two routes:

- `POST /videos/probe` takes `{ "url": "<public video URL>" }`, runs an ffprobe job and answers its duration, size and video codec.
- `POST /webhooks/rendobar` verifies Rendobar's signature and handles each event by type. An event newer than the SDK gets a 2xx so Rendobar does not retry it.

| File | What it shows |
|---|---|
| [`src/app.module.ts`](src/app.module.ts) | `RendobarModule.forRootAsync` reading the key, API URL and webhook secret from `ConfigService` |
| [`src/videos.service.ts`](src/videos.service.ts) | `RendobarClient` injected by type, a typed ffprobe result |
| [`src/videos.controller.ts`](src/videos.controller.ts) | `RendobarApiErrorFilter` on one controller: a Rendobar refusal answers 502 |
| [`src/webhooks.controller.ts`](src/webhooks.controller.ts), [`src/webhook-events.service.ts`](src/webhook-events.service.ts) | `@RendobarWebhook()`, `isKnownWebhookEvent` and an exhaustive switch on the event |
| [`src/webhook-receiver.module.ts`](src/webhook-receiver.module.ts) | A webhooks-only service that starts without an API key |
| [`src/main.ts`](src/main.ts) | `rawBody: true`, which the signature check needs |

## Run it

```bash
npm install
RENDOBAR_API_KEY=rb_... RENDOBAR_WEBHOOK_SECRET=whsec_... npm start
curl -X POST localhost:3000/videos/probe -H 'content-type: application/json' \
  -d '{"url":"https://cdn.rendobar.com/assets/examples/sample.mp4"}'
```

`RENDOBAR_API_URL` points the client at another API server.

## Test it

`npm test` builds the app and runs [`test/app.test.ts`](test/app.test.ts): it compiles the module with `@nestjs/testing`, starts the app on a free port and sends it real HTTP requests. It needs `RENDOBAR_API_URL` and `RENDOBAR_API_KEY`. Against a real API it runs one ffprobe job and creates and deletes one webhook endpoint. From the repository root, `node examples/run.mjs` runs it against the conformance mock.
