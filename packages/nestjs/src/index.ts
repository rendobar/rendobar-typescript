/**
 * Rendobar for NestJS: an injectable client and a webhook signature guard.
 *
 *   @Module({ imports: [RendobarModule.forRoot({ webhookSecret: process.env.RENDOBAR_WEBHOOK_SECRET })] })
 *   export class AppModule {}
 *
 *   @Injectable()
 *   export class VideosService {
 *     constructor(@InjectRendobar() private readonly rb: RendobarClient) {}
 *   }
 *
 * The guard needs the raw request body: create the app with
 * `NestFactory.create(AppModule, { rawBody: true })`.
 */
import { Readable } from "node:stream";
import {
  BadRequestException,
  CanActivate,
  createParamDecorator,
  DynamicModule,
  ExecutionContext,
  Inject,
  Injectable,
  InternalServerErrorException,
  Module,
  PayloadTooLargeException,
  Provider,
  UnauthorizedException,
  type FactoryProvider,
  type ModuleMetadata,
} from "@nestjs/common";
import { ApiError, createClient, type ClientConfig, type RendobarClient } from "@rendobar/sdk";
import { verifyWebhook } from "@rendobar/sdk/webhooks";
import { VERSION } from "./version";

export const RENDOBAR_CLIENT = Symbol("RENDOBAR_CLIENT");
// Not exported: it carries the signing secret, and nothing outside this module needs it.
const RENDOBAR_OPTIONS = Symbol("RENDOBAR_OPTIONS");

export type RendobarModuleOptions = ClientConfig & {
  /** The endpoint's signing secret, for RendobarSignatureGuard. */
  webhookSecret?: string;
};

export type RendobarModuleAsyncOptions = Pick<ModuleMetadata, "imports"> & {
  inject?: FactoryProvider["inject"];
  useFactory: (...args: never[]) => RendobarModuleOptions | Promise<RendobarModuleOptions>;
};

/** Injects the configured Rendobar client. */
export const InjectRendobar = (): ParameterDecorator & PropertyDecorator => Inject(RENDOBAR_CLIENT);

/** Whether the SDK will have something to authenticate with: an option, or RENDOBAR_API_KEY. */
function hasCredentials(config: ClientConfig): boolean {
  return Boolean(config.apiKey || config.accessToken || config.credentials || process.env.RENDOBAR_API_KEY);
}

const clientProvider: Provider = {
  provide: RENDOBAR_CLIENT,
  inject: [RENDOBAR_OPTIONS],
  // The client header names this package, so the API can tell NestJS traffic apart.
  // The signing secret stays with the guard: the API client never needs it.
  useFactory: ({ webhookSecret: _secret, ...config }: RendobarModuleOptions) => {
    // Fail at startup, where the cause is, instead of on the first call. Same code as
    // the SDK's own local refusal, so both read as MISSING_API_KEY.
    if (!hasCredentials(config)) {
      throw new ApiError(
        "MISSING_API_KEY",
        401,
        "RendobarModule has no API key. Pass apiKey in the RendobarModule options or set the RENDOBAR_API_KEY environment variable.",
      );
    }
    return createClient({ client: `nestjs/${VERSION}`, ...config });
  },
};

@Module({})
export class RendobarModule {
  /** Registers the client app-wide. With no apiKey, the client reads RENDOBAR_API_KEY. */
  static forRoot(options: RendobarModuleOptions = {}): DynamicModule {
    return {
      module: RendobarModule,
      global: true,
      providers: [{ provide: RENDOBAR_OPTIONS, useValue: options }, clientProvider, RendobarSignatureGuard],
      exports: [RENDOBAR_CLIENT, RENDOBAR_OPTIONS, RendobarSignatureGuard],
    };
  }

  /** The same, with options from a factory, such as ConfigService. */
  static forRootAsync(options: RendobarModuleAsyncOptions): DynamicModule {
    return {
      module: RendobarModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        { provide: RENDOBAR_OPTIONS, inject: options.inject ?? [], useFactory: options.useFactory },
        clientProvider,
        RendobarSignatureGuard,
      ],
      exports: [RENDOBAR_CLIENT, RENDOBAR_OPTIONS, RendobarSignatureGuard],
    };
  }
}

type RawRequest = { rawBody?: Buffer; headers: Record<string, string | string[] | undefined> };

/** The envelope of each request the guard verified, parsed from the signed bytes. */
const verifiedEvents = new WeakMap<object, unknown>();

// The cap body-parser puts on the JSON body Rendobar sends, so a body no parser
// claimed cannot be larger than one that a parser did.
const MAX_UNPARSED_BYTES = 100 * 1024;

/**
 * The bytes of a body no parser read. `rawBody: true` keeps only the bodies the
 * JSON and urlencoded parsers read, so another content type, such as
 * text/plain, arrives as an unread stream. A body a parser read without
 * keeping it (an app without rawBody) cannot be read again, and gets undefined.
 */
async function readUnparsedBody(req: RawRequest): Promise<Buffer | undefined> {
  if (!(req instanceof Readable) || req.readableDidRead) return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buf.length;
    if (size > MAX_UNPARSED_BYTES) throw new PayloadTooLargeException("Rendobar webhook body is too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Lets a request through only when it carries a valid Rendobar signature for
 * the configured webhookSecret, signed in the last five minutes. Verifies the
 * raw body of any content type.
 */
@Injectable()
export class RendobarSignatureGuard implements CanActivate {
  constructor(@Inject(RENDOBAR_OPTIONS) private readonly options: RendobarModuleOptions) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const secret = this.options.webhookSecret;
    if (!secret) throw new InternalServerErrorException("RendobarSignatureGuard needs webhookSecret in RendobarModule options.");
    const req = context.switchToHttp().getRequest<RawRequest>();
    const raw = req.rawBody ?? (await readUnparsedBody(req));
    if (!raw) {
      throw new InternalServerErrorException("RendobarSignatureGuard needs the raw body: NestFactory.create(AppModule, { rawBody: true }).");
    }
    const body = raw.toString("utf8");
    const ok = await verifyWebhook(body, req.headers, secret);
    // 401, as the SDK docs and every example answer: the request is not authenticated.
    if (!ok) throw new UnauthorizedException("Invalid or stale Rendobar signature");
    try {
      verifiedEvents.set(req, JSON.parse(body));
    } catch {
      throw new BadRequestException("The signed Rendobar webhook body is not JSON");
    }
    return true;
  }
}

/**
 * The verified webhook envelope, parsed from the exact bytes the guard
 * verified. Type the parameter as `WebhookPayload` and switch on `event.event`:
 * `event.data` narrows to that event's shape. Needs RendobarSignatureGuard on
 * the route, and says so with a 500 when it is missing.
 */
export const RendobarEvent: () => ParameterDecorator = createParamDecorator((_: unknown, context: ExecutionContext): unknown => {
  const req = context.switchToHttp().getRequest<RawRequest>();
  if (!verifiedEvents.has(req)) throw new InternalServerErrorException("@RendobarEvent() needs RendobarSignatureGuard on the route.");
  return verifiedEvents.get(req);
});

export type { RendobarClient, WebhookEventDataMap, WebhookPayload } from "@rendobar/sdk";
