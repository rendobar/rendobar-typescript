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
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Module,
  Provider,
  type FactoryProvider,
  type ModuleMetadata,
} from "@nestjs/common";
import { createClient, type ClientConfig, type RendobarClient } from "@rendobar/sdk";
import { verifyWebhook } from "@rendobar/sdk/webhooks";
import { VERSION } from "./version";

export const RENDOBAR_CLIENT = Symbol("RENDOBAR_CLIENT");
export const RENDOBAR_OPTIONS = Symbol("RENDOBAR_OPTIONS");

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

const clientProvider: Provider = {
  provide: RENDOBAR_CLIENT,
  inject: [RENDOBAR_OPTIONS],
  // The client header names this package, so the API can tell NestJS traffic apart.
  // The signing secret stays with the guard: the API client never needs it.
  useFactory: ({ webhookSecret: _secret, ...config }: RendobarModuleOptions) => createClient({ client: `nestjs/${VERSION}`, ...config }),
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
    if (!ok) throw new ForbiddenException("Invalid Rendobar signature");
    return true;
  }
}

/** The verified webhook envelope (`event`, `data`, ...), parsed from the body. */
export const RendobarEvent = createParamDecorator((_: unknown, context: ExecutionContext) => {
  return context.switchToHttp().getRequest<RawRequest>().body;
});

export type { RendobarClient } from "@rendobar/sdk";
