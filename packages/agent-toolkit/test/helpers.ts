/**
 * Clients the tests share. Every file talks to the one conformance mock
 * (rendobar/openapi conformance/mock_server.py) and resets it first.
 */
import { cpSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type ClientConfig } from "@rendobar/sdk";

export const MOCK = process.env["RENDOBAR_MOCK"] ?? "http://127.0.0.1:4100";

export const reset = async (flags = "") => {
  await fetch(`${MOCK}/__reset${flags}`, { method: "POST" });
};

type Logged = { method: string; path: string; query: string; idempotencyKey: string | null };
/** Every request the mock received since the last reset, in order. */
export const requests = async (): Promise<Logged[]> => (await (await fetch(`${MOCK}/__requests`)).json()).data;
export const createdCount = async (): Promise<number> => (await (await fetch(`${MOCK}/__created`)).json()).data.count;

/** A client on the mock. */
export const mockClient = (config: Omit<ClientConfig, "apiKey" | "baseUrl"> = {}) => createClient({ apiKey: "rb_test", baseUrl: MOCK, ...config });

/** A client whose every request gets this one answer. */
export const answering = (status: number, error: { code: string; message: string; details?: unknown }) =>
  createClient({
    apiKey: "rb_test",
    baseUrl: MOCK,
    maxRetries: 0,
    fetch: async () => new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } }),
  });

/** A client that records every URL it would fetch and sends nothing, for tests that must send nothing. */
export function recording(apiKey: string | null = "rb_test") {
  const sent: string[] = [];
  const client = createClient({
    ...(apiKey === null ? {} : { apiKey }),
    baseUrl: "http://api.test",
    fetch: async (url) => {
      sent.push(String(url));
      return new Response("{}");
    },
  });
  return { client, sent };
}

/** A client that records each submit's body and refuses it, to see exactly what a tool sends. */
export function refusingSubmits() {
  const bodies: unknown[] = [];
  const client = createClient({
    apiKey: "rb_test",
    baseUrl: "http://api.test",
    maxRetries: 0,
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "stop here" } }), { status: 400 });
    },
  });
  return { client, bodies };
}

/** A client on the mock whose job reads (GET /jobs/<id>) are rewritten, to serve a job the mock cannot. */
export function rewritingJobs(rewrite: (job: Record<string, unknown>) => Record<string, unknown>) {
  return mockClient({
    fetch: async (url, init) => {
      const res = await fetch(url, init);
      if ((init?.method ?? "GET") !== "GET" || !/\/jobs\/job_/.test(String(url))) return res;
      const body = await res.json();
      return new Response(JSON.stringify({ data: rewrite(body.data) }), { status: res.status, headers: { "content-type": "application/json" } });
    },
  });
}

/**
 * A second, separate copy of the installed SDK, as in an app with two installs
 * of it. Its classes are not the toolkit's, so only the SDK's brand checks can
 * recognise its errors. Copied next to the installed one so its own
 * dependencies resolve; `remove` deletes it.
 */
export async function secondSdkCopy() {
  const installed = realpathSync(resolve(process.cwd(), "node_modules/@rendobar/sdk"));
  const copy = join(dirname(installed), "sdk-second-copy");
  cpSync(installed, copy, { recursive: true });
  const sdk: typeof import("@rendobar/sdk") = await import(pathToFileURL(join(copy, "dist/index.mjs")).href);
  return { sdk, remove: () => rmSync(copy, { recursive: true, force: true }) };
}

/**
 * A client whose job never finishes, and which aborts `controller` from inside
 * its first poll. Cancellation is then tested without any clock: the abort
 * lands while the SDK is between polls, every time.
 */
export function abortingOnFirstPoll(controller: AbortController) {
  const seen = { submits: 0, polls: 0 };
  const json = (data: unknown, status: number) => new Response(JSON.stringify({ data }), { status, headers: { "content-type": "application/json" } });
  const client = createClient({
    apiKey: "rb_test",
    baseUrl: "http://api.test",
    maxRetries: 0,
    fetch: async (_url, init) => {
      if (init?.method === "POST") {
        seen.submits += 1;
        return json({ id: "job_1", status: "waiting" }, 201);
      }
      seen.polls += 1;
      controller.abort();
      return json({ id: "job_1", type: "ffprobe", status: "running" }, 200);
    },
  });
  return { client, seen };
}
