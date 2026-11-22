import { Controller, HttpCode, Post } from "@nestjs/common";
import { RendobarWebhook, type RendobarWebhookEvent } from "@rendobar/nestjs";
import { WebhookEventsService } from "./webhook-events.service";

@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly events: WebhookEventsService) {}

  // A bad or stale signature never reaches this method: the guard answers 401.
  @Post("rendobar")
  @HttpCode(200)
  @RendobarWebhook()
  receive(event: RendobarWebhookEvent): { handled: string } {
    return { handled: this.events.dispatch(event) };
  }
}
