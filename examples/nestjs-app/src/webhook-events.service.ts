import { Injectable, Logger } from "@nestjs/common";
import {
  isKnownWebhookEvent,
  type RendobarWebhookEvent,
  type UnknownWebhookEvent,
  type WebhookEventDataMap,
  type WebhookPayload,
} from "@rendobar/nestjs";

/** Routes each verified webhook delivery and says what it did. */
@Injectable()
export class WebhookEventsService {
  private readonly logger = new Logger(WebhookEventsService.name);

  dispatch(event: RendobarWebhookEvent): string {
    const outcome = isKnownWebhookEvent(event) ? this.known(event) : this.unknown(event);
    this.logger.log(outcome);
    return outcome;
  }

  private known(event: WebhookPayload): string {
    // `event.data` narrows on `event.event`.
    switch (event.event) {
      case "job.completed":
        return this.completed(event.data);
      case "job.failed":
        return `job ${event.data.jobId} failed: ${event.data.error.code}`;
      case "job.created":
      case "job.started":
      case "job.cancelled":
      case "job.delivery_succeeded":
      case "job.delivery_failed":
      case "job.deliveries_settled":
        return `${event.event} for job ${event.data.jobId}`;
      case "balance.low":
      case "balance.depleted":
        return `${event.event}: balance ${event.data.balanceFormatted}`;
      case "test":
        return `test delivery for endpoint ${event.data.endpointId}`;
      default: {
        // A compile error here means the SDK knows an event this switch does not handle.
        const unhandled: never = event;
        return unhandled;
      }
    }
  }

  private completed(data: WebhookEventDataMap["job.completed"]): string {
    return `job ${data.jobId} complete: ${data.output.file?.url ?? "no output file"}`;
  }

  /** An event newer than this SDK. Answer 2xx anyway, so Rendobar does not retry it. */
  private unknown(event: UnknownWebhookEvent): string {
    return `ignored ${event.event}`;
  }
}
