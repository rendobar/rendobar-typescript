import { Module, type DynamicModule, type ModuleMetadata, type Provider } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { RendobarApiErrorFilter } from "./api-error.filter";
import { buildClient, RendobarClient } from "./client";
import type { RendobarModuleOptions, RendobarModuleSetup } from "./options";
import { RENDOBAR_WEBHOOKS } from "./webhooks";

// Not exported: the options carry the signing secret, and nothing outside this module needs them.
const RENDOBAR_OPTIONS = Symbol("RendobarModule options");

/** A token `forRootAsync` can inject: a class, or a string or symbol provider name. */
type FactoryToken = (abstract new (...args: never[]) => unknown) | string | symbol;
/** What injecting a token gives the factory: the instance for a class, unknown for a name. */
type Injected<T> = T extends abstract new (...args: never[]) => infer Instance ? Instance : unknown;

export type RendobarModuleAsyncOptions<Tokens extends readonly FactoryToken[]> = RendobarModuleSetup & {
  imports?: ModuleMetadata["imports"];
  /** Providers to inject into `useFactory`, in parameter order. */
  inject?: Tokens;
  useFactory: (...args: { [K in keyof Tokens]: Injected<Tokens[K]> }) => RendobarModuleOptions | Promise<RendobarModuleOptions>;
};

function providers(options: Provider, setup: RendobarModuleSetup): Provider[] {
  return [
    options,
    { provide: RendobarClient, inject: [RENDOBAR_OPTIONS], useFactory: (o: RendobarModuleOptions) => buildClient(o.client ?? {}) },
    { provide: RENDOBAR_WEBHOOKS, inject: [RENDOBAR_OPTIONS], useFactory: (o: RendobarModuleOptions) => o.webhooks ?? null },
    ...(setup.apiErrorFilter === false ? [] : [{ provide: APP_FILTER, useClass: RendobarApiErrorFilter }]),
  ];
}

@Module({})
export class RendobarModule {
  /** Registers the client app-wide. With no client.apiKey, the client reads RENDOBAR_API_KEY. */
  static forRoot(options: RendobarModuleOptions & RendobarModuleSetup = {}): DynamicModule {
    const { apiErrorFilter, ...runtime } = options;
    return {
      module: RendobarModule,
      global: true,
      providers: providers({ provide: RENDOBAR_OPTIONS, useValue: runtime }, { apiErrorFilter }),
      exports: [RendobarClient, RENDOBAR_WEBHOOKS],
    };
  }

  /** The same, with options from a factory, such as one reading ConfigService. */
  static forRootAsync<const Tokens extends readonly FactoryToken[] = []>(options: RendobarModuleAsyncOptions<Tokens>): DynamicModule {
    return {
      module: RendobarModule,
      global: true,
      imports: options.imports ?? [],
      providers: providers(
        // Nest calls the factory with the injected instances in `inject` order, which the parameter types follow.
        { provide: RENDOBAR_OPTIONS, inject: [...(options.inject ?? [])], useFactory: options.useFactory },
        { apiErrorFilter: options.apiErrorFilter },
      ),
      exports: [RendobarClient, RENDOBAR_WEBHOOKS],
    };
  }
}
