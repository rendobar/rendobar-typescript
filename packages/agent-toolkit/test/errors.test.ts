/**
 * Every failure reaches the model as data. A thrown error would end the whole
 * agent loop, so a dropped connection must come back as something to act on.
 */
import { createClient } from "@rendobar/sdk";
import { describe, expect, it } from "vitest";
import { rendobarToolDefinitions } from "../src/core.js";

describe("tool errors", () => {
  it("returns a network failure as an error object instead of throwing", async () => {
    const client = createClient({
      apiKey: "rb_test",
      baseUrl: "http://api.test",
      maxRetries: 0,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const tools = rendobarToolDefinitions({ client });

    const result = await tools.get_job.run({ id: "job_1" });

    expect(result).toEqual({ error: { code: "REQUEST_FAILED", message: "fetch failed. The call can be retried." } });
  });
});
