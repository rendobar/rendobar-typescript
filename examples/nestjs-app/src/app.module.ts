import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import {
  RendobarModule,
  type RendobarClientOptions,
  type RendobarModuleAsyncOptions,
  type RendobarModuleOptions,
  type RendobarModuleSetup,
  type RendobarWebhookOptions,
} from "@rendobar/nestjs";
import { VideosController } from "./videos.controller";
import { VideosService } from "./videos.service";
import { WebhookEventsService } from "./webhook-events.service";
import { WebhooksController } from "./webhooks.controller";

/** Rendobar's settings, read from the environment (or a .env file) through ConfigService. */
export function rendobarOptions(config: ConfigService): RendobarModuleOptions {
  const client: RendobarClientOptions = {
    // Unset values stay undefined: the client then reads RENDOBAR_API_KEY and uses api.rendobar.com.
    apiKey: config.get<string>("RENDOBAR_API_KEY"),
    baseUrl: config.get<string>("RENDOBAR_API_URL"),
    app: "nestjs-example",
  };
  const webhooks: RendobarWebhookOptions = { secret: config.getOrThrow<string>("RENDOBAR_WEBHOOK_SECRET") };
  return { client, webhooks };
}

// The error filter is bound on VideosController instead of app-wide.
const setup: RendobarModuleSetup = { apiErrorFilter: false };

const rendobar: RendobarModuleAsyncOptions<readonly [typeof ConfigService]> = {
  ...setup,
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: rendobarOptions,
};

@Module({
  imports: [ConfigModule.forRoot(), RendobarModule.forRootAsync(rendobar)],
  controllers: [VideosController, WebhooksController],
  providers: [VideosService, WebhookEventsService],
})
export class AppModule {}
