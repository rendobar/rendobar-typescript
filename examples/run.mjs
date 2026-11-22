#!/usr/bin/env node
/**
 * Runs every example project as a user would install it: each Rendobar package
 * an example depends on is built and packed with `npm pack`, the example is
 * copied to a temp folder, installed from those tarballs, then type-checked
 * and tested with its own `npm test`.
 *
 *   node examples/run.mjs --mode mock   # against the conformance mock (default)
 *   node examples/run.mjs --mode live   # against RENDOBAR_API_URL with RENDOBAR_API_KEY
 *   node examples/run.mjs --mode mock nestjs-app   # one example
 *
 * Mock mode needs the mock from rendobar/openapi running (CI starts it):
 *   python3 -I .openapi/conformance/mock_server.py .openapi/openapi.json 4100 requests.jsonl &
 * It uses RENDOBAR_API_URL when set, else http://127.0.0.1:4100.
 *
 * RENDOBAR_SDK_TARBALL installs @rendobar/sdk from a local tarball instead of
 * npm, to test against an SDK that is not released yet.
 * RENDOBAR_WEBHOOK_VECTORS points at conformance/webhook-vectors.json; it
 * defaults to the copy in .openapi/, where CI checks out rendobar/openapi.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const examplesDir = import.meta.dirname;
const repo = resolve(examplesDir, "..");

const { values, positionals } = parseArgs({ options: { mode: { type: "string", default: "mock" } }, allowPositionals: true });
const mode = values.mode;
if (mode !== "mock" && mode !== "live") throw new Error(`--mode is mock or live, not ${mode}`);

/** Every folder under examples/ with its own package.json is an example project. */
const all = readdirSync(examplesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "node_modules" && existsSync(join(examplesDir, d.name, "package.json")))
  .map((d) => d.name);
const unknown = positionals.filter((name) => !all.includes(name));
if (unknown.length > 0) throw new Error(`No example named ${unknown.join(", ")}. Examples: ${all.join(", ")}`);
const selected = positionals.length > 0 ? positionals : all;

function run(command, args, options = {}) {
  // npm and pnpm are .cmd shims on Windows, which only start through a shell.
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32", ...options });
  return result.status === 0;
}

function capture(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: process.platform === "win32", stdio: ["ignore", "pipe", "inherit"] });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed in ${cwd}`);
  return result.stdout.trim();
}

async function environment() {
  const vectors = process.env.RENDOBAR_WEBHOOK_VECTORS ?? join(repo, ".openapi/conformance/webhook-vectors.json");
  const shared = { RENDOBAR_MODE: mode, ...(existsSync(vectors) ? { RENDOBAR_WEBHOOK_VECTORS: vectors } : {}) };
  if (mode === "live") {
    for (const name of ["RENDOBAR_API_URL", "RENDOBAR_API_KEY"]) if (!process.env[name]) throw new Error(`--mode live needs ${name}`);
    return shared;
  }
  const url = process.env.RENDOBAR_API_URL ?? "http://127.0.0.1:4100";
  const up = await fetch(`${url}/__reset`, { method: "POST" }).then((r) => r.ok, () => false);
  if (!up) throw new Error(`No conformance mock answers at ${url}. Start it (see the top of examples/run.mjs) or set RENDOBAR_API_URL.`);
  return { ...shared, RENDOBAR_API_URL: url, RENDOBAR_API_KEY: "rb_examples_mock" };
}

const env = { ...process.env, ...(await environment()) };
const work = mkdtempSync(join(tmpdir(), "rendobar-examples-"));
const sdkTarball = process.env.RENDOBAR_SDK_TARBALL;
if (sdkTarball !== undefined && !existsSync(sdkTarball)) throw new Error(`RENDOBAR_SDK_TARBALL ${sdkTarball} does not exist`);

/** Builds packages/<name> and packs it, once per run. Returns the tarball's path. */
const packed = new Map();
function pack(name) {
  const dir = join(repo, "packages", name);
  if (!existsSync(join(dir, "package.json"))) throw new Error(`No package in packages/${name}`);
  if (!packed.has(name)) {
    if (!run("pnpm", ["run", "build"], { cwd: dir })) throw new Error(`Building packages/${name} failed`);
    const file = capture("npm", ["pack", "--silent", "--pack-destination", work], dir).split("\n").pop();
    packed.set(name, join(work, file));
  }
  return packed.get(name);
}

/** The install spec for each @rendobar/* dependency: this repo's packages packed, the SDK from npm or RENDOBAR_SDK_TARBALL. */
function rendobarSpecs(manifest) {
  const specs = {};
  for (const name of Object.keys(manifest.dependencies ?? {}).filter((n) => n.startsWith("@rendobar/"))) {
    if (name === "@rendobar/sdk") {
      if (sdkTarball !== undefined) specs[name] = `file:${resolve(sdkTarball)}`;
    } else {
      specs[name] = `file:${pack(name.slice("@rendobar/".length))}`;
    }
  }
  return specs;
}

const results = [];
try {
  for (const name of selected) {
    console.log(`\n=== ${name} (${mode}) ===`);
    const dir = join(work, name);
    cpSync(join(examplesDir, name), dir, { recursive: true, filter: (src) => !/[\\/](node_modules|dist)([\\/]|$)/.test(src.slice(examplesDir.length)) });
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    manifest.dependencies = { ...manifest.dependencies, ...rendobarSpecs(manifest) };
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2));

    // A local SDK tarball may carry a version below the packages' peer range
    // (a release candidate before its version bump); npm would refuse it.
    const peers = sdkTarball === undefined ? [] : ["--legacy-peer-deps"];
    if (mode === "mock") await fetch(`${env.RENDOBAR_API_URL}/__reset`, { method: "POST" });
    const ok = run("npm", ["install", "--no-audit", "--no-fund", "--no-package-lock", ...peers], { cwd: dir }) && run("npm", ["test"], { cwd: dir, env });
    results.push({ name, ok });
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log("");
for (const { name, ok } of results) console.log(`${ok ? "PASS" : "FAIL"} ${name} (${mode})`);
process.exit(results.length === selected.length && results.every((r) => r.ok) ? 0 : 1);
