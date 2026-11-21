import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { isApiError, type ApiError } from "@rendobar/sdk";

/**
 * Matches any Rendobar ApiError, from any copy of the SDK in the process: Nest
 * picks a filter with `instanceof`, and this class answers that with the SDK's
 * brand check instead of one copy's class.
 */
class AnyApiError {
  static [Symbol.hasInstance](value: unknown): boolean {
    return isApiError(value);
  }
}

/**
 * Nest answers an unknown error that has `statusCode` and `message` with that
 * status and message, so an uncaught Rendobar ApiError would reach your users
 * as Rendobar's own refusal: a revoked key as your app's 401, low credits as a
 * 402. This filter answers 502 with a generic body instead, and logs the code
 * and request id, which Rendobar support needs.
 */
@Catch(AnyApiError)
export class RendobarApiErrorFilter implements ExceptionFilter<ApiError> {
  private readonly logger = new Logger("RendobarModule");

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(error: ApiError, host: ArgumentsHost): void {
    this.logger.error(`Rendobar API error ${error.code} (HTTP ${error.statusCode}), request ${error.requestId ?? "none"}: ${error.message}`);
    // Only HTTP has a response to write. Elsewhere the error goes on to the context's own handling.
    if (host.getType() !== "http") throw error;
    this.adapterHost.httpAdapter.reply(host.switchToHttp().getResponse(), { statusCode: 502, message: "Bad Gateway" }, 502);
  }
}
