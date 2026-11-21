import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { VERSION } from "../src/version";

// X-Rendobar-Client must report this package's real version (.claude client-attribution rule, tier 3).
it("VERSION matches package.json", () => {
  const pkg = JSON.parse(readFileSync(`${process.cwd()}/package.json`, "utf8")) as { version: string };
  expect(VERSION).toBe(pkg.version);
});
