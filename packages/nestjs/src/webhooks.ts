/**
 * Webhook verification: `@RendobarWebhook()` on a handler verifies the
 * signature against the raw bytes, parses the event from those same bytes,
 * and hands it to the handler's first parameter.
 *
 * Express only (Nest's default adapter): the guard reads Express's raw body
 * and request stream.
 */
import { Readable } from "node:stream";
import {
  BadRequestException,
  createParamDecorator,
  Inject,
  Injectable,
  InternalServerErrorException,
  PayloadTooLargeException,
  UnauthorizedException,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { UnknownWebhookEvent, WebhookPayload } from "@rendobar/sdk";
import { parseWebhookPayload, verifyWebhook } from "@rendobar/sdk/webhooks";
import type { RendobarWebhookOptions } from "./options";

/** A verified delivery: a known event, typed by `event`, or one newer than this SDK, typed as unknown. */
export type RendobarWebhookEvent = WebhookPayload | UnknownWebhookEvent;

/** The webhook options, or null when the module has none. Not exported: it carries the secret. */
export const RENDOBAR_WEBHOOKS = Symbol("RendobarModule webhooks options");

// The JSON parser's default limit, so a body no parser took cannot be larger than one it did.
const DEFAULT_MAX_BODY_BYTES = 100 * 1024;

type RawRequest = { rawBody?: Buffer; headers: Record<string, string | string[] | undefined> };

/** The event of each request the guard verified, parsed from the signed bytes. */
const verifiedEvents = new WeakMap<object, RendobarWebhookEvent>();

/**
 * The bytes of a body no parser read. `rawBody: true` keeps only the bodies the
 * JSON and urlencoded parsers read, so another content type, such as
 * text/plain, arrives as an unread stream. A body a parser read without
 * keeping it (an app without rawBody) cannot be read again, and gets undefined.
 */
async function readUnparsedBody(req: RawRequest, maxBytes: number): Promise<Buffer | undefined> {
  if (!(req instanceof Readable) || req.readableDidRead) return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buf.length;
    if (size > maxBytes) throw new PayloadTooLargeException(`Rendobar webhook body is over ${maxBytes} bytes (webhooks.maxBodyBytes)`);
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

@Injectable()
class RendobarSignatureGuard implements CanActivate {
  private readonly webhooks: RendobarWebhookOptions;

  // Built when a route uses @RendobarWebhook(), at startup: a missing secret fails the app there.
  constructor(@Inject(RENDOBAR_WEBHOOKS) webhooks: RendobarWebhookOptions | null) {
    if (webhooks === null) throw new Error("@RendobarWebhook() needs webhooks: { secret } in the RendobarModule options.");
    if (webhooks.secret.trim() === "") throw new Error("RendobarModule webhooks.secret is empty.");
    this.webhooks = webhooks;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RawRequest>();
    const raw = req.rawBody ?? (await readUnparsedBody(req, this.webhooks.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES));
    if (!raw) {
      throw new InternalServerErrorException("@RendobarWebhook() needs the raw body: NestFactory.create(AppModule, { rawBody: true }).");
    }
    const body = raw.toString("utf8");
    const tolerance = this.webhooks.toleranceSec;
    const ok = await verifyWebhook(body, req.headers, this.webhooks.secret, tolerance === undefined ? {} : { toleranceSec: tolerance });
    // 401, as the SDK docs and every example answer: the request is not authenticated.
    if (!ok) throw new UnauthorizedException("Invalid or stale Rendobar signature");
    try {
      verifiedEvents.set(req, parseWebhookPayload(body));
    } catch {
      // Signed by the secret's holder, but not a webhook envelope: refuse it rather than guess.
      throw new BadRequestException("The signed Rendobar webhook body is not a webhook envelope");
    }
    return true;
  }
}

const VerifiedEvent = createParamDecorator((_: unknown, context: ExecutionContext): RendobarWebhookEvent => {
  const event = verifiedEvents.get(context.switchToHttp().getRequest<RawRequest>());
  // The guard runs before any parameter is resolved and sets the event or refuses the request.
  if (event === undefined) throw new InternalServerErrorException("The Rendobar webhook event is missing: the guard did not run.");
  return event;
});

/**
 * Marks a handler as the Rendobar webhook receiver. It verifies the signature
 * (401 on a bad or stale one) and passes the event as the first parameter,
 * which must accept a `RendobarWebhookEvent`: annotating it with a narrower or
 * unrelated type does not compile. Switch on `event.event` after
 * `isKnownWebhookEvent(event)` and `event.data` narrows.
 */
export function RendobarWebhook() {
  return <M extends (event: RendobarWebhookEvent, ...rest: never[]) => unknown>(target: object, key: string | symbol, descriptor: TypedPropertyDescriptor<M>): void => {
    UseGuards(RendobarSignatureGuard)(target, key, descriptor);
    VerifiedEvent()(target, key, 0);
  };
}
