/**
 * Runs the shared SDK conformance scenarios (rendobar/openapi conformance/SCENARIOS.md)
 * against this SDK and prints a results object. CI fails unless every id passes.
 *
 *   RENDOBAR_MOCK=http://127.0.0.1:4100 SDK=../dist/index.mjs tsx run.mts
 */
const base = process.env.RENDOBAR_MOCK ?? "http://127.0.0.1:4100";
const sdk = await import(process.env.SDK ?? "@rendobar/sdk");
const { createClient, isApiError } = sdk;

const results: Record<string, string> = {};
const reset = (q = "") => fetch(`${base}/__reset${q}`, { method: "POST" });
async function scenario(id: string, fn: () => Promise<boolean | string>) {
  try {
    const r = await fn();
    results[id] = r === true ? "pass" : `fail: ${r === false ? "assertion" : r}`;
  } catch (e) {
    results[id] = `fail: ${(e as Error)?.constructor?.name} ${(e as Error)?.message}`.slice(0, 200);
  }
}
const sent: Array<{ url: string; headers: Headers; body: string }> = [];
const spyFetch: typeof fetch = async (url, init) => {
  sent.push({ url: String(url), headers: new Headers(init?.headers), body: String(init?.body ?? "") });
  return fetch(url, init);
};
const rb = createClient({ apiKey: "rb_conformance", baseUrl: base, fetch: spyFetch });

await reset();
await scenario("C01", async () => (await createClient({ baseUrl: base }).jobs.types()).length > 0);
await scenario("C02", async () => (await rb.jobs.get("job_x")).id === "job_x");
await scenario("C03", async () => typeof (await rb.jobs.create({ type: "ffprobe", params: { command: "https://x/a.mp4" } })).id === "string");
await scenario("C04", async () => { let n = 0; for await (const _ of rb.jobs.listAll({})) n++; return n === 120 || `got ${n}`; });
await scenario("C05", async () => { try { await rb.jobs.get("job_404"); return "no error"; } catch (e) { return (isApiError(e) && e.code === "NOT_FOUND" && e.statusCode === 404) || String(e); } });
await reset();
await scenario("C06", async () => { const t = Date.now(); await rb.jobs.get("job_flaky"); const ms = Date.now() - t; return (ms >= 900 && ms < 3000) || `took ${ms} ms`; });
await scenario("C07", async () => { try { await rb.jobs.get("job_503"); return "no error"; } catch (e) { return (isApiError(e) && e.statusCode === 503) || String(e); } });
await scenario("C08", async () => {
  const fast = createClient({ apiKey: "k", baseUrl: base, timeout: 2000, maxRetries: 0 });
  const t = Date.now();
  try { await fast.jobs.get("job_slow"); return "no timeout"; } catch { const ms = Date.now() - t; return (ms >= 1800 && ms < 4000) || `after ${ms} ms`; }
});
await scenario("C09", async () => { const j = await rb.jobs.get("job_future"); return j.status === ("paused" as string) || `status ${j.status}`; });
await scenario("C10", async () => { const r = await rb.jobs.download("job_x"); return (await r.arrayBuffer()).byteLength === 1024; });
await scenario("C11", async () => sent.length > 0 && sent.every((s) => /^sdk\/\d+\.\d+\.\d+/.test(s.headers.get("X-Rendobar-Client") ?? "")) || "missing or unversioned X-Rendobar-Client");
await scenario("C12", async () => { try { await rb.jobs.get("job_404"); return "no error"; } catch (e) { return (isApiError(e) && /^req_/.test(e.requestId ?? "")) || "no requestId"; } });
await reset("?lose_submit=1");
await scenario("C13", async () => {
  sent.length = 0;
  await rb.jobs.create({ type: "ffprobe", params: { command: "https://x/a.mp4" } });
  const keys = sent.filter((s) => s.url.endsWith("/jobs")).map((s) => JSON.parse(s.body).idempotencyKey);
  const created = (await (await fetch(`${base}/__created`)).json()).data.count;
  return (keys.length === 2 && keys[0] && keys[0] === keys[1] && created === 1) || `keys ${JSON.stringify(keys)}, created ${created}`;
});
await scenario("C14", async () => {
  const seen: Array<{ method: string; path: string; deprecatedAt: Date }> = [];
  const c = createClient({ apiKey: "k", baseUrl: base, onDeprecation: (n: { method: string; path: string; deprecatedAt: Date }) => seen.push(n) });
  await c.jobs.get("job_x"); // current endpoint: silent
  await c.billing.checkoutPro(); // deprecated since 2026-10-17
  await c.billing.checkoutPro(); // once per endpoint
  const ok = seen.length === 1 && seen[0]?.path === "/billing/checkout/pro" && seen[0]?.deprecatedAt.toISOString().startsWith("2026-10-17");
  return ok || `notices ${JSON.stringify(seen)}`;
});
await scenario("C15", async () => {
  process.env.RENDOBAR_API_KEY = "rb_from_env";
  sent.length = 0;
  await createClient({ baseUrl: base, fetch: spyFetch }).jobs.get("job_x");
  delete process.env.RENDOBAR_API_KEY;
  return sent[0]?.headers.get("Authorization") === "Bearer rb_from_env" || "env key not sent";
});

console.log(JSON.stringify(results, null, 2));
const failed = Object.entries(results).filter(([, v]) => v !== "pass");
process.exit(failed.length === 0 && Object.keys(results).length === 15 ? 0 : 1);
