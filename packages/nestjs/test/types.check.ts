/**
 * Compile-time checks, run by `tsc --noEmit` (pnpm typecheck), never executed.
 * Each `@ts-expect-error` line is a program that must not compile: if it ever
 * compiles, the directive itself fails the typecheck.
 */
import { Injectable } from "@nestjs/common";
import { RendobarClient, RendobarModule } from "../src/index";

class ConfigLike {
  get(key: string): string | undefined {
    return process.env[key];
  }
}

// Options read from config may be undefined: that compiles under exactOptionalPropertyTypes.
RendobarModule.forRoot({ client: { apiKey: new ConfigLike().get("RENDOBAR_API_KEY"), timeout: undefined } });
// @ts-expect-error credentials (browser cookie auth) is not a module option
RendobarModule.forRoot({ client: { credentials: "include" } });
// @ts-expect-error the client names itself; `client` is not an option
RendobarModule.forRoot({ client: { client: "mine" } });
// @ts-expect-error webhooks need a secret
RendobarModule.forRoot({ webhooks: { toleranceSec: 300 } });

// useFactory gets the injected providers, typed, in `inject` order.
RendobarModule.forRootAsync({ inject: [ConfigLike], useFactory: (config: ConfigLike) => ({ client: { apiKey: config.get("K") } }) });
// @ts-expect-error the factory's parameter must be what `inject` provides
RendobarModule.forRootAsync({ inject: [ConfigLike], useFactory: (port: number) => ({ client: { timeout: port } }) });
// @ts-expect-error a factory that takes a parameter needs `inject`
RendobarModule.forRootAsync({ useFactory: (config: ConfigLike) => ({ client: { apiKey: config.get("K") } }) });
// apiErrorFilter is decided at definition time, outside the factory.
RendobarModule.forRootAsync({ apiErrorFilter: false, useFactory: () => ({}) });

// The client is injected by type and has the SDK client's members.
@Injectable()
export class Videos {
  constructor(private readonly rb: RendobarClient) {}
  probe(url: string) {
    return this.rb.jobs.run({ type: "ffprobe", params: { command: url } });
  }
}
