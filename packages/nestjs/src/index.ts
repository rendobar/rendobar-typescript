/**
 * Rendobar for NestJS: an injectable client, webhook verification, and a
 * filter that keeps Rendobar's refusals from reaching your users.
 *
 *   @Module({ imports: [RendobarModule.forRoot({ webhooks: { secret } })] })
 *   export class AppModule {}
 *
 *   @Injectable()
 *   export class VideosService {
 *     constructor(private readonly rb: RendobarClient) {}
 *   }
 *
 * Webhooks need the raw request body: create the app with
 * `NestFactory.create(AppModule, { rawBody: true })`.
 */
export { RendobarApiErrorFilter } from "./api-error.filter";
export { RendobarClient } from "./client";
export { RendobarModule, type RendobarModuleAsyncOptions } from "./module";
export type { RendobarClientOptions, RendobarModuleOptions, RendobarModuleSetup, RendobarWebhookOptions } from "./options";
export { RendobarWebhook, type RendobarWebhookEvent } from "./webhooks";
export type { UnknownWebhookEvent, WebhookEventDataMap, WebhookPayload } from "@rendobar/sdk";
export { isKnownWebhookEvent } from "@rendobar/sdk/webhooks";
