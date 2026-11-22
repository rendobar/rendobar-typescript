<p align="center">
  <a href="https://rendobar.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://cdn.rendobar.com/assets/brand/logo-mark.svg">
      <img alt="Rendobar" src="https://cdn.rendobar.com/assets/brand/logo-mark-black.svg" width="80">
    </picture>
  </a>
</p>

<h1 align="center">Rendobar NestJS module</h1>

<p align="center"><code>@rendobar/nestjs</code></p>

<p align="center">
  <strong>The official NestJS module for Rendobar's media processing and AI generation API.</strong>
</p>

<p align="center">
  <a href="https://rendobar.com/docs/sdk">Docs</a> &nbsp;·&nbsp;
  <a href="https://rendobar.com/integrations/nestjs/">Guide</a> &nbsp;·&nbsp;
  <a href="https://api.rendobar.com/reference">API reference</a> &nbsp;·&nbsp;
  <a href="https://www.npmjs.com/package/@rendobar/nestjs">npm</a> &nbsp;·&nbsp;
  <a href="https://app.rendobar.com">Get an API key</a> &nbsp;·&nbsp;
  <a href="https://discord.com/invite/kAGqjBzx8N">Discord</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@rendobar/nestjs"><img src="https://img.shields.io/npm/v/@rendobar/nestjs?style=flat-square&color=059669&label=npm" alt="npm version"></a>
  <img src="https://img.shields.io/node/v/@rendobar/nestjs?style=flat-square&color=059669" alt="Node version">
  <img src="https://img.shields.io/npm/l/@rendobar/nestjs?style=flat-square&color=059669" alt="License">
</p>

The official NestJS module for Rendobar's media processing and AI generation API. It adds an injectable client for every media job, verifies webhooks before your handler runs, and keeps Rendobar's refusals out of your users' responses. It supports NestJS 10 and 11 on Node 22 or later, is typed end to end, and keeps the retries and idempotency of [`@rendobar/sdk`](https://www.npmjs.com/package/@rendobar/sdk).

## Install

```bash
npm install @rendobar/nestjs @rendobar/sdk
```

## Quickstart

Register the module once:

```ts
// app.module.ts
import { Module } from "@nestjs/common";
import { RendobarModule } from "@rendobar/nestjs";

const secret = process.env["RENDOBAR_WEBHOOK_SECRET"];
if (!secret) throw new Error("Set RENDOBAR_WEBHOOK_SECRET");

@Module({
  imports: [RendobarModule.forRoot({ webhooks: { secret } })],
})
export class AppModule {}
```

With no `client.apiKey`, the client reads `RENDOBAR_API_KEY`. If neither is set, the app fails at startup with `MISSING_API_KEY` and an error that names both, instead of failing later on the first API call. An empty or blank `apiKey` fails the same way.

An app that only receives webhooks needs no key. Pass `webhooks` and no `client`, and the app starts without one. If it does call the client, that call is refused with `MISSING_API_KEY` before any request.

Then inject `RendobarClient` by type and run a job:

```ts
// videos.service.ts
import { Injectable } from "@nestjs/common";
import { RendobarClient } from "@rendobar/nestjs";
import type { TypedJob } from "@rendobar/sdk";

@Injectable()
export class VideosService {
  constructor(private readonly rb: RendobarClient) {}

  probe(url: string): Promise<TypedJob<"ffprobe">> {
    return this.rb.jobs.run({ type: "ffprobe", params: { command: url } });
  }
}
```

## Let your AI assistant do it

Paste this one line into Claude, ChatGPT, or Cursor and the assistant reads the
full integration playbook, detects your stack, and wires Rendobar into your
codebase. Your API key stays in your env file, never in the chat.

```text
Add Rendobar to my app: read and follow https://rendobar.com/prompts/integrate.md
```

## Options

| Option | What it sets |
|---|---|
| `client.apiKey` | The API key. Defaults to `RENDOBAR_API_KEY` |
| `client.baseUrl` | The API server. Defaults to `https://api.rendobar.com` |
| `client.timeout` | Request timeout in milliseconds. Defaults to 30000 |
| `client.maxRetries` | Retries on a 429 or 5xx. Defaults to 2 |
| `client.orgId` | The organization to act in, for a key with access to several |
| `client.app` | Your app's name, sent with each request so support can tell your apps apart |
| `webhooks.secret` | The signing secret webhooks are verified against |
| `webhooks.toleranceSec` | How old a signature may be, in seconds. Defaults to 300 |
| `webhooks.maxBodyBytes` | The largest body the guard reads itself, for a content type no body parser takes. Defaults to 102400 |
| `apiErrorFilter` | Set `false` to handle Rendobar errors yourself. See below |

`client` takes every `createClient` option of `@rendobar/sdk` except `credentials` and `client`. Every option also accepts `undefined`, so a value read from config can be passed as it is.

To read options from `ConfigService`, use `forRootAsync`. `useFactory` gets the providers in `inject`, typed, in that order:

```ts
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { RendobarModule } from "@rendobar/nestjs";

@Module({
  imports: [
    ConfigModule.forRoot(),
    RendobarModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        client: { apiKey: config.get<string>("RENDOBAR_API_KEY") },
        webhooks: { secret: config.getOrThrow<string>("RENDOBAR_WEBHOOK_SECRET") },
      }),
    }),
  ],
})
export class AppModule {}
```

## Rendobar errors in your responses

Nest answers an error that has `statusCode` and `message` with that status and message. Left alone, an uncaught Rendobar `ApiError` would reach your users as Rendobar's own refusal: a revoked key as your app's 401, low credits as a 402. The module registers a filter that answers any `ApiError` with a 502 and a generic body, and logs its code and `requestId` (what Rendobar support asks for).

To handle Rendobar errors yourself, catch them in your service, or put your own filter on a controller or handler with `@UseFilters`, which runs before the module's. To turn the module's filter off, pass `apiErrorFilter: false` to `forRoot` or `forRootAsync`.

## Verify webhooks

The signature is checked against the exact bytes Rendobar sent, so create the app with `rawBody` on:

```ts
// main.ts
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Rendobar sends JSON. Raise the JSON parser's 100 KB default if your jobs return large output data.
  app.useBodyParser("json", { limit: "1mb" });
  await app.listen(3000);
}
void bootstrap();
```

Put `@RendobarWebhook()` on the handler. It verifies the signature, parses the event from the bytes it verified, and passes it as the first parameter. That parameter must accept a `RendobarWebhookEvent`: annotating it with a narrower or unrelated type does not compile, with or without `strictFunctionTypes`. `isKnownWebhookEvent(event)` narrows to the events this SDK version knows, and then `event.data` narrows on `event.event`. A newer event arrives typed as an unknown event instead of failing.

```ts
// webhooks.controller.ts
import { Controller, HttpCode, Post } from "@nestjs/common";
import { isKnownWebhookEvent, RendobarWebhook, type RendobarWebhookEvent } from "@rendobar/nestjs";

@Controller("webhooks")
export class WebhooksController {
  @Post("rendobar")
  @HttpCode(204)
  @RendobarWebhook()
  handle(event: RendobarWebhookEvent) {
    // Signed by Rendobar in the last five minutes.
    if (isKnownWebhookEvent(event) && event.event === "job.completed") console.log(event.data.jobId, event.data.output);
  }
}
```

A bad or stale signature gets a 401, and a signed body that is not a webhook envelope a 400. `@RendobarWebhook()` with no `webhooks` options stops the app at startup. Without `rawBody` it answers 500 and names the fix. A body over the limit gets a 413, and the connection stays usable for the next request.

Webhook verification needs the Express adapter, Nest's default.

## Examples

[`examples/nestjs-app`](https://github.com/rendobar/rendobar-typescript/tree/main/examples/nestjs-app) is a NestJS app on this module: an endpoint that probes a video and returns the typed result, and a webhook route that verifies and handles each event.

## Other Rendobar SDKs

- TypeScript: [`@rendobar/sdk`](https://www.npmjs.com/package/@rendobar/sdk) on npm, the client these packages build on.
- Python: [`rendobar`](https://pypi.org/project/rendobar/) on PyPI.
- Go: [`github.com/rendobar/rendobar-go`](https://pkg.go.dev/github.com/rendobar/rendobar-go) on pkg.go.dev.
- Agent toolkit: [`@rendobar/agent-toolkit`](https://www.npmjs.com/package/@rendobar/agent-toolkit), Rendobar tools for the Vercel AI SDK, Mastra and LangChain.js.

## Versioning and support

`@rendobar/nestjs` follows semantic versioning. While it is at 0.x, a minor release may
tighten types, and the changelog says so when one does. Deprecations are
announced before anything is removed. See the
[versioning policy](https://rendobar.com/docs/support/versioning) and the
[changelog](https://rendobar.com/changelog/).

Report a bug at
[rendobar/rendobar-typescript issues](https://github.com/rendobar/rendobar-typescript/issues),
or ask on [Discord](https://discord.com/invite/kAGqjBzx8N).

## License

[MIT](https://github.com/rendobar/rendobar-typescript/blob/main/LICENSE). Rendobar is a product of Craftobar LLC.
