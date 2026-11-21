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
import {
  CanActivate,
  createParamDecorator,
  DynamicModule,
  ExecutionContext,
  Inject,
  Injectable,
  InternalServerErrorException,
  Module,
  Provider,
  UnauthorizedException,
  type FactoryProvider,
  type ModuleMetadata,
} from "@nestjs/common";
import { createClient, type ClientConfig, type RendobarClient } from "@rendobar/sdk";
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
    // Fail at startup, where the cause is, instead of with a 401 on the first call.
    if (!hasCredentials(config)) {
      throw new Error("RendobarModule has no API key. Pass apiKey in the RendobarModule options or set the RENDOBAR_API_KEY environment variable.");
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

type RawRequest = { rawBody?: Buffer; body?: unknown; headers: Record<string, string | string[] | undefined> };

/**
 * Lets a request through only when it carries a valid Rendobar signature for
 * the configured webhookSecret, signed in the last five minutes.
 */
@Injectable()
export class RendobarSignatureGuard implements CanActivate {
  constructor(@Inject(RENDOBAR_OPTIONS) private readonly options: RendobarModuleOptions) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const secret = this.options.webhookSecret;
    if (!secret) throw new InternalServerErrorException("RendobarSignatureGuard needs webhookSecret in RendobarModule options.");
    const req = context.switchToHttp().getRequest<RawRequest>();
    if (!req.rawBody) {
      throw new InternalServerErrorException("RendobarSignatureGuard needs the raw body: NestFactory.create(AppModule, { rawBody: true }).");
    }
    const ok = await verifyWebhook(req.rawBody.toString("utf8"), req.headers, secret);
    // 401, as the SDK docs and every example answer: the request is not authenticated.
    if (!ok) throw new UnauthorizedException("Invalid or stale Rendobar signature");
    return true;
  }
}

/**
 * The verified webhook envelope, parsed from the body. Type the parameter as
 * `WebhookPayload` and switch on `event.event`: `event.data` narrows to that
 * event's shape. Use it behind RendobarSignatureGuard, which is what makes the
 * body trustworthy.
 */
export const RendobarEvent: () => ParameterDecorator = createParamDecorator((_: unknown, context: ExecutionContext): unknown => {
  return context.switchToHttp().getRequest<RawRequest>().body;
});

export type { RendobarClient, WebhookEventDataMap, WebhookPayload } from "@rendobar/sdk";
