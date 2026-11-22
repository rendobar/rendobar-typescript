import { ApiError, createClient, type RendobarClient as SdkClient } from "@rendobar/sdk";
import { toClientConfig, type RendobarClientOptions } from "./options";
import { VERSION } from "./version";

/**
 * The Rendobar client, and the token it is injected by. Inject it by type:
 *
 *   constructor(private readonly rb: RendobarClient) {}
 *
 * The class has no body: the interface of the same name gives it the SDK
 * client's members, and Nest needs a class at runtime to inject by type.
 */
export abstract class RendobarClient {}
// Declaration merging: the token class carries the SDK client's type. It is never constructed.
export interface RendobarClient extends SdkClient {}

const MISSING =
  "RendobarModule has no API key. Pass client.apiKey in the RendobarModule options or set the RENDOBAR_API_KEY environment variable.";

const blank = (value: string | undefined) => value !== undefined && value.trim() === "";

/**
 * Builds the client, failing at startup where the cause is rather than on the
 * first call. The check matches the SDK's: an option given is used, and only
 * with none does the SDK read RENDOBAR_API_KEY. So an empty or blank apiKey is
 * its own error here, not a fall-through to the variable.
 *
 * `webhooksOnly`: the module was given webhook options and no client options,
 * so the app may only receive webhooks, which need no key. It then starts
 * without one, and the client refuses its first call with the SDK's local
 * MISSING_API_KEY instead.
 */
export function buildClient(options: RendobarClientOptions, webhooksOnly: boolean): SdkClient {
  if (blank(options.apiKey) || blank(options.accessToken)) {
    throw new ApiError("MISSING_API_KEY", 401, "RendobarModule was given an empty or blank client.apiKey or client.accessToken.");
  }
  const fromEnv = process.env["RENDOBAR_API_KEY"];
  const configured = options.apiKey !== undefined || options.accessToken !== undefined || (fromEnv !== undefined && fromEnv !== "");
  if (!configured && !webhooksOnly) {
    throw new ApiError("MISSING_API_KEY", 401, MISSING);
  }
  // The client header names this package, so the API can tell NestJS traffic apart.
  return createClient({ ...toClientConfig(options), client: `nestjs/${VERSION}` });
}
