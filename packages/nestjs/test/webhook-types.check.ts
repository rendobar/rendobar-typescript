/**
 * Compile-time checks for @RendobarWebhook(), never executed. typecheck runs
 * them twice, with and without strictFunctionTypes (tsconfig.loose.json), since
 * the handler check must hold in a project that turns it off.
 */
import { Controller, Post } from "@nestjs/common";
import { RendobarWebhook, type RendobarWebhookEvent, type WebhookPayload } from "../src/index";

@Controller()
export class Hooks {
  @Post("ok")
  @RendobarWebhook()
  ok(event: RendobarWebhookEvent) {
    return event.event;
  }

  @Post("extra")
  @RendobarWebhook()
  extra(event: RendobarWebhookEvent, note?: string) {
    return [event.deliveryId, note];
  }

  @Post("narrow")
  // @ts-expect-error the handler must accept every verified delivery, including events newer than this SDK
  @RendobarWebhook()
  narrow(event: WebhookPayload) {
    return event.event;
  }

  @Post("wrong")
  // @ts-expect-error an unrelated parameter type does not compile
  @RendobarWebhook()
  wrong(event: { amount: number }) {
    return event.amount;
  }
}
