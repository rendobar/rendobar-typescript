import type { ClientConfig } from "@rendobar/sdk";

type ClientSettings = Omit<ClientConfig, "credentials" | "client">;

/**
 * Every `createClient` option from `@rendobar/sdk` this module passes on, each
 * also accepting `undefined` so a value read from config can be passed as is.
 * `credentials` (cookie auth, for a browser) and `client` (this module names
 * itself) are left out.
 */
export type RendobarClientOptions = { [K in keyof ClientSettings]?: ClientSettings[K] | undefined };

export type RendobarWebhookOptions = {
  /** The endpoint's signing secret (`whsec_...`). During a rotation the guard also accepts the previous secret's signature. */
  secret: string;
  /** How old a signature may be, in seconds. Default 300. */
  toleranceSec?: number | undefined;
  /**
   * The largest body, in bytes, the guard reads itself: one in a content type
   * no body parser took. Default 102400, the JSON parser's own default. A
   * JSON body is capped by the JSON parser instead (see the README).
   */
  maxBodyBytes?: number | undefined;
};

/** What the module needs at runtime. `forRootAsync` builds this in its factory. */
export type RendobarModuleOptions = {
  client?: RendobarClientOptions | undefined;
  /** Set it to verify webhooks. `@RendobarWebhook()` without it fails at startup. */
  webhooks?: RendobarWebhookOptions | undefined;
};

/** Decided when the module is defined, so it cannot come from an async factory. */
export type RendobarModuleSetup = {
  /**
   * Answer an uncaught Rendobar ApiError with a 502 and log it, instead of
   * letting Nest pass Rendobar's status and message to your users. Default
   * true. Set false to handle ApiError with your own filter.
   */
  apiErrorFilter?: boolean | undefined;
};

/** The SDK reads an undefined option as an absent one; this drops them so the object is a ClientConfig. */
export function toClientConfig(options: RendobarClientOptions): ClientSettings {
  const present = Object.entries(options).filter(([, value]) => value !== undefined);
  // Every entry kept is a key of ClientSettings with a non-undefined value of that key's type.
  return Object.fromEntries(present) as ClientSettings;
}
