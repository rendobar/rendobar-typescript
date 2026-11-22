import { Module, type DynamicModule } from "@nestjs/common";
import { RendobarModule } from "@rendobar/nestjs";
import { WebhookEventsService } from "./webhook-events.service";
import { WebhooksController } from "./webhooks.controller";

/**
 * A service that only receives Rendobar webhooks. It has webhook options and
 * no client options, so it starts without an API key.
 */
@Module({})
export class WebhookReceiverModule {
  static withSecret(secret: string): DynamicModule {
    return {
      module: WebhookReceiverModule,
      imports: [RendobarModule.forRoot({ webhooks: { secret } })],
      controllers: [WebhooksController],
      providers: [WebhookEventsService],
    };
  }
}
