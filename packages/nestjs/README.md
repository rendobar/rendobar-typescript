# @rendobar/nestjs

Add Rendobar to a NestJS app: an injectable client for every media job, and a guard that verifies webhook signatures before your controller runs.

```bash
npm install @rendobar/nestjs @rendobar/sdk
```

## Register the module

```ts
import { Module } from "@nestjs/common";
import { RendobarModule } from "@rendobar/nestjs";

@Module({
  imports: [RendobarModule.forRoot({ webhookSecret: process.env.RENDOBAR_WEBHOOK_SECRET })],
})
export class AppModule {}
```

With no `apiKey`, the client reads `RENDOBAR_API_KEY`. To read options from `ConfigService`, use `RendobarModule.forRootAsync({ imports, inject, useFactory })`.

## Use the client

```ts
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
const app = await NestFactory.create(AppModule, { rawBody: true });
```

```ts
import { Controller, Post, UseGuards } from "@nestjs/common";
import { RendobarEvent, RendobarSignatureGuard } from "@rendobar/nestjs";

@Controller("webhooks")
export class WebhooksController {
  @Post("rendobar")
  @UseGuards(RendobarSignatureGuard)
  handle(@RendobarEvent() event: { event: string; data: unknown }) {
    // Signed by Rendobar in the last five minutes.
  }
}
```

A bad or stale signature gets a 403. A missing `webhookSecret` or a missing raw body is a 500 that names the fix.

Supports NestJS 10 and 11. MIT licensed.
