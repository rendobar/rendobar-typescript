/**
 * Clients the tests share. Every file talks to the one conformance mock
 * (rendobar/openapi conformance/mock_server.py) and resets it first.
 */
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
