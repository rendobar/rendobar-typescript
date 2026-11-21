# @rendobar/nestjs

Add Rendobar to a NestJS app: an injectable client for every media job, and a guard that verifies webhook signatures before your controller runs.

```bash
npm install @rendobar/nestjs @rendobar/sdk
```

## Register the module

```ts
// app.module.ts
import { Module } from "@nestjs/common";
import { RendobarModule } from "@rendobar/nestjs";

@Module({
  imports: [RendobarModule.forRoot({ webhookSecret: process.env.RENDOBAR_WEBHOOK_SECRET })],
})
export class AppModule {}
```

With no `apiKey`, the client reads `RENDOBAR_API_KEY`. If neither is set, the app fails at startup with an error that names both, instead of failing later on the first API call.

## Options

`forRoot()` takes every option of `createClient` from `@rendobar/sdk`, plus `webhookSecret` for the guard:

| Option | What it sets |
|---|---|
| `apiKey` | The API key. Defaults to `RENDOBAR_API_KEY` |
| `baseUrl` | The API server. Defaults to `https://api.rendobar.com` |
| `timeout` | Request timeout in milliseconds. Defaults to 30000 |
| `maxRetries` | Retries on a 429 or 5xx. Defaults to 2 |
| `orgId` | The organization to act in, for a key with access to several |
| `app` | Your app's name, sent with each request so support can tell your apps apart |
| `webhookSecret` | The signing secret `RendobarSignatureGuard` checks against |

To read them from `ConfigService`, use `forRootAsync`:

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
        apiKey: config.getOrThrow<string>("RENDOBAR_API_KEY"),
        webhookSecret: config.getOrThrow<string>("RENDOBAR_WEBHOOK_SECRET"),
      }),
    }),
  ],
})
export class AppModule {}
```

## Use the client

```ts
// videos.service.ts
import { Injectable } from "@nestjs/common";
import { InjectRendobar, type RendobarClient } from "@rendobar/nestjs";

@Injectable()
export class VideosService {
  constructor(@InjectRendobar() private readonly rb: RendobarClient) {}

  probe(url: string) {
    return this.rb.jobs.run({ type: "ffprobe", params: { command: url } });
  }
}
```

## Verify webhooks

The guard checks the signature against the exact bytes Rendobar sent, so create the app with `rawBody` on:

```ts
// main.ts
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  await app.listen(3000);
}
void bootstrap();
```

`@RendobarEvent()` hands your handler the envelope, parsed from the exact bytes the guard verified. Type it as `WebhookPayload` and switch on `event.event`, and `event.data` narrows to that event's fields.

```ts
// webhooks.controller.ts
import { Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { RendobarEvent, RendobarSignatureGuard, type WebhookPayload } from "@rendobar/nestjs";

@Controller("webhooks")
export class WebhooksController {
  @Post("rendobar")
  @HttpCode(204)
  @UseGuards(RendobarSignatureGuard)
  handle(@RendobarEvent() event: WebhookPayload) {
    // Signed by Rendobar in the last five minutes.
    if (event.event === "job.completed") console.log(event.data.jobId, event.data.output);
  }
}
```

The guard verifies a body of any content type. A bad or stale signature gets a 401. A missing `webhookSecret`, a missing raw body or `@RendobarEvent()` on a route without the guard is a 500 that names the fix.

Supports NestJS 10 and 11. MIT licensed.
