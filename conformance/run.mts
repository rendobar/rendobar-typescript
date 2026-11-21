/**
 * Runs the shared SDK conformance scenarios (rendobar/openapi conformance/SCENARIOS.md)
 * against this SDK and prints a results object. CI fails unless every id passes,
 * or is "n/a" where SCENARIOS.md says the scenario is not for TypeScript.
 *
 *   RENDOBAR_MOCK=http://127.0.0.1:4100 SDK=../dist/index.mjs tsx run.mts
 */
const base = process.env.RENDOBAR_MOCK ?? "http://127.0.0.1:4100";
const sdk = await import(process.env.SDK ?? "@rendobar/sdk");
const { createClient, isApiError, JobFailedError } = sdk;

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

await reset();
await scenario("C16", async () => {
  const job = await rb.jobs.run({ type: "ffprobe", params: { command: "https://x/a.mp4" } }, { interval: 50 });
  return (job.status === "complete" && typeof job.output.file?.url === "string") || `status ${job.status}`;
});
await scenario("C17", async () => {
  try { await rb.jobs.wait("job_failed", { throwOnFailure: true, interval: 50 }); return "no error"; } catch (e) { return (e instanceof JobFailedError && e.status === "failed" && e.jobId === "job_failed") || String(e); }
});
await scenario("C18", async () => {
  sent.length = 0;
  try { await rb.jobs.get("job_409"); return "no error"; } catch (e) {
    const hits = sent.filter((s) => s.url.endsWith("/jobs/job_409")).length;
    return (isApiError(e) && e.statusCode === 409 && hits === 1) || `status ${isApiError(e) ? e.statusCode : String(e)}, ${hits} requests`;
  }
});

// ---- C19 to C39 ----------------------------------------------------------
type Logged = { method: string; path: string; query: string; idempotencyKey: string | null };
const requests = async (): Promise<Logged[]> => (await (await fetch(`${base}/__requests`)).json()).data;
const createdCount = async (): Promise<number> => (await (await fetch(`${base}/__created`)).json()).data.count;
const hitsTo = async (path: string) => (await requests()).filter((r) => r.path === path).length;
const timed = async (fn: () => Promise<unknown>): Promise<{ ms: number; error: unknown; value: unknown }> => {
  const t = Date.now();
  try {
    const value = await fn();
    return { ms: Date.now() - t, error: undefined, value };
  } catch (error) {
    return { ms: Date.now() - t, error, value: undefined };
  }
};
const code = (e: unknown) => (isApiError(e) ? e.code : String(e));
const field = (o: unknown, k: string): unknown => (typeof o === "object" && o !== null ? Reflect.get(o, k) : undefined);

await reset();
await scenario("C19", async () => {
  const saved = process.env.RENDOBAR_API_KEY;
  delete process.env.RENDOBAR_API_KEY;
  try {
    await createClient({ baseUrl: base }).jobs.get("job_x");
    return "no error";
  } catch (e) {
    const ok = isApiError(e) && e.code === "MISSING_API_KEY" && e.message.includes("RENDOBAR_API_KEY") && e.message.includes("apiKey");
    const n = (await requests()).length;
    return (ok && n === 0) || `${code(e)}, ${n} requests`;
  } finally {
    if (saved !== undefined) process.env.RENDOBAR_API_KEY = saved;
  }
});
results.C20 = "n/a"; // not for typescript: apiKey also takes OAuth tokens, so there is no rb_ prefix check
await reset();
await scenario("C21", async () => {
  const c = createClient({ apiKey: "k", baseUrl: `${base}/` });
  await c.jobs.get("job_x");
  await c.jobs.list({});
  const paths = (await requests()).map((r) => r.path);
  return (paths.join(" ") === "/jobs/job_x /jobs" && paths.every((p) => !p.includes("//"))) || `paths ${JSON.stringify(paths)}`;
});
await reset("?stall_submit=1");
await scenario("C22", async () => {
  const c = createClient({ apiKey: "k", baseUrl: base, timeout: 2000, maxRetries: 0 });
  const body = { type: "ffprobe", params: { command: "https://x/a.mp4" } };
  const first = await timed(() => c.jobs.create(body));
  const sentKey = (await requests())[0]?.idempotencyKey;
  if (first.error === undefined || first.ms < 1800 || first.ms >= 4000) return `first submit ${first.error === undefined ? "succeeded" : "raised"} after ${first.ms} ms`;
  const carried = field(first.error, "idempotencyKey");
  if (carried !== sentKey) return `error ${String(first.error)} carries idempotencyKey ${JSON.stringify(carried)}, the request sent ${JSON.stringify(sentKey)}`;
  const again = await c.jobs.create({ ...body, idempotencyKey: sentKey });
  const created = await createdCount();
  return (again.id === "job_0001" && created === 1) || `resubmit got ${again.id}, created ${created}`;
});
await reset();
await scenario("C23", async () => {
  const first = await rb.jobs.create({ type: "ffprobe", params: { command: "https://x/a.mp4" }, idempotencyKey: "conformance-c23" });
  const posts = async () => (await requests()).filter((r) => r.method === "POST" && r.path === "/jobs").length;
  const before = await posts();
  try {
    await rb.jobs.create({ type: "ffprobe", params: { command: "https://x/b.mp4" }, idempotencyKey: "conformance-c23" });
    return "no error";
  } catch (e) {
    const n = (await posts()) - before;
    const ok = isApiError(e) && e.statusCode === 409 && e.code === "CONFLICT" && field(e.details, "jobId") === first.id;
    return (ok && n === 1 && (await createdCount()) === 1) || `${code(e)}, details ${JSON.stringify(isApiError(e) ? e.details : null)}, ${n} posts`;
  }
});
await reset();
await scenario("C24", async () => {
  const body = { type: "ffprobe", params: { command: "https://x/a.mp4" }, idempotencyKey: "conformance-c24" };
  const a = await rb.jobs.create(body);
  const b = await rb.jobs.create(body);
  return (a.id === b.id && (await createdCount()) === 1) || `ids ${a.id} ${b.id}`;
});
await reset();
await scenario("C25", async () => {
  const r = await timed(() => rb.jobs.get("job_503_ra"));
  const hits = await hitsTo("/jobs/job_503_ra");
  return (r.error === undefined && hits === 2 && r.ms >= 900 && r.ms < 3000) || `${r.error === undefined ? "ok" : code(r.error)}, ${hits} requests, ${r.ms} ms`;
});
await reset();
await scenario("C26", async () => {
  const r = await timed(() => rb.jobs.get("job_ra_long"));
  const hits = await hitsTo("/jobs/job_ra_long");
  const ok = isApiError(r.error) && r.error.statusCode === 429 && r.error.retryAfter === 3600;
  return (ok && hits === 1 && r.ms < 2000) || `${code(r.error)} retryAfter ${field(r.error, "retryAfter")}, ${hits} requests, ${r.ms} ms`;
});
await reset();
await scenario("C27", async () => {
  const r = await timed(() => rb.jobs.get("job_ra_date"));
  const hits = await hitsTo("/jobs/job_ra_date");
  return (r.error === undefined && hits === 2 && r.ms >= 900 && r.ms < 3500) || `${r.error === undefined ? "ok" : code(r.error)}, ${hits} requests, ${r.ms} ms`;
});
await reset();
await scenario("C28", async () => {
  const r = await timed(() => rb.jobs.get("job_501"));
  const hits = await hitsTo("/jobs/job_501");
  return (isApiError(r.error) && r.error.statusCode === 501 && hits === 1) || `${code(r.error)}, ${hits} requests`;
});
const listOffsets = async () =>
  (await requests()).filter((r) => r.method === "GET" && r.path === "/jobs").map((r) => Number(new URLSearchParams(r.query).get("offset") ?? "0"));
await reset();
await scenario("C29", async () => {
  const ids = new Set<string>();
  for await (const j of rb.jobs.listAll({ limit: 500 })) ids.add(j.id);
  const offsets = await listOffsets();
  return (ids.size === 120 && offsets.join(",") === "0,100") || `${ids.size} ids, offsets ${offsets.join(",")}`;
});
await reset("?phantom_total=1");
await scenario("C30", async () => {
  let n = 0;
  for await (const _ of rb.jobs.listAll({ limit: 100 })) n++;
  const offsets = await listOffsets();
  return (n === 60 && offsets.join(",") === "0,60") || `${n} jobs, offsets ${offsets.join(",")}`;
});
const refusalCodes = async (calls: Array<() => Promise<unknown>>) => {
  const codes: string[] = [];
  for (const call of calls) {
    try {
      await call();
      codes.push("no error");
    } catch (e) {
      codes.push(code(e));
    }
  }
  return codes;
};
await reset();
await scenario("C31", async () => {
  const codes = await refusalCodes([() => rb.jobs.list({ limit: -1 }), () => rb.jobs.list({ offset: -1 }), () => rb.jobs.list({ limit: 0 })]);
  const n = (await requests()).length;
  return (codes.every((c) => c === "INVALID_ARGUMENT") && n === 0) || `codes ${codes.join(",")}, ${n} requests`;
});
await reset();
await scenario("C32", async () => {
  const codes = await refusalCodes(["", "a/b", ".."].map((id) => () => rb.jobs.get(id)));
  const n = (await requests()).length;
  return (codes.every((c) => c === "INVALID_ARGUMENT") && n === 0) || `codes ${codes.join(",")}, ${n} requests`;
});
await reset();
await scenario("C33", async () => {
  try {
    await rb.jobs.create({ type: "no_such_type", params: {} });
    return "no error";
  } catch (e) {
    const p = isApiError(e) ? e.problems?.[0] : undefined;
    const ok = isApiError(e) && e.statusCode === 400 && e.code === "VALIDATION_ERROR" && p?.path.join(".") === "type" && p.message === 'Unknown job type "no_such_type"';
    return ok || `${code(e)}, problems ${JSON.stringify(isApiError(e) ? e.problems : null)}`;
  }
});
await reset();
await scenario("C34", async () => {
  const r = await timed(() => rb.jobs.wait("job_stuck", { timeout: 3000 }));
  const e = r.error;
  if (!(e instanceof sdk.WaitTimeoutError)) return `raised ${String(e)}`;
  const lastId = field(field(e, "lastJob") ?? field(e, "job"), "id");
  const ok = e.jobId === "job_stuck" && e.lastStatus === "running" && lastId === "job_stuck";
  return (ok && r.ms >= 2500 && r.ms < 5000) || `id ${e.jobId}, last status ${e.lastStatus}, last job id ${JSON.stringify(lastId)}, ${r.ms} ms`;
});
await reset();
await scenario("C35", async () => {
  const waited = await rb.jobs.wait("job_cancelled");
  if (waited.status !== "cancelled") return `wait returned ${waited.status}`;
  await reset("?cancel_created=1");
  try {
    await rb.jobs.run({ type: "ffprobe", params: { command: "https://x/a.mp4" } }, { interval: 50 });
    return "run did not raise";
  } catch (e) {
    const ok = e instanceof JobFailedError && e.code === "JOB_CANCELLED" && e.status === "cancelled" && field(e.job, "status") === "cancelled";
    return ok || `${String(e)}, code ${field(e, "code")}`;
  }
});
results.C36 = "n/a"; // not for typescript: it keeps its existing timeout semantics
await reset();
await scenario("C37", async () => {
  const r = await timed(() => rb.jobs.wait("job_future", { timeout: 3000 }));
  const e = r.error;
  return (e instanceof sdk.WaitTimeoutError && e.lastStatus === "paused" && r.ms >= 2500 && r.ms < 5000) || `raised ${String(e)} after ${r.ms} ms`;
});
await reset();
await scenario("C38", async () => {
  const { readFileSync } = await import("node:fs");
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.resolve(process.env.SDK ?? "@rendobar/sdk")), "utf8"));
  sent.length = 0;
  await createClient({ apiKey: "k", baseUrl: base, app: "conformance", fetch: spyFetch }).jobs.get("job_x");
  const header = sent[0]?.headers.get("X-Rendobar-Client") ?? "";
  const want = `sdk/${manifest.version} (node/${process.versions.node}; app/conformance)`;
  return header === want || `sent ${JSON.stringify(header)}, want ${JSON.stringify(want)}`;
});
await scenario("C39", async () => {
  const { readFileSync } = await import("node:fs");
  const { verifyWebhook } = await import(process.env.SDK_WEBHOOKS ?? "@rendobar/sdk/webhooks");
  const vectors = JSON.parse(readFileSync(process.env.VECTORS ?? ".openapi/conformance/webhook-vectors.json", "utf8"));
  const wrong: string[] = [];
  const realNow = Date.now;
  try {
    for (const c of vectors.cases) {
      if (c.notFor?.includes("typescript")) continue;
      // Each case is checked at its own clock: the vector's timestamp unless it names `now`.
      Date.now = () => (c.now ?? vectors.timestamp) * 1000;
      let got: boolean;
      try {
        got = await verifyWebhook(c.body ?? vectors.body, c.headers, c.secret ?? vectors.secret);
      } catch {
        got = false; // a verifier may throw on a refused secret; either way the request does not verify
      }
      if (got !== c.expect) wrong.push(c.name);
    }
  } finally {
    Date.now = realNow;
  }
  return wrong.length === 0 || `wrong: ${wrong.join("; ")}`;
});

console.log(JSON.stringify(results, null, 2));
// SCENARIOS.md marks C20 and C36 "not for typescript": those, and only those, may be n/a.
const NOT_FOR_TYPESCRIPT = new Set(["C20", "C36"]);
const failed = Object.entries(results).filter(([id, v]) => !(v === "pass" || (v === "n/a" && NOT_FOR_TYPESCRIPT.has(id))));
process.exit(failed.length === 0 && Object.keys(results).length === 39 ? 0 : 1);
