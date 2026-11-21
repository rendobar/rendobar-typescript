import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { VERSION } from "../src/version";

// X-Rendobar-Client must report this package's real version (a constant checked against package.json, so it cannot drift).
it("VERSION matches package.json", () => {
  const pkg = JSON.parse(readFileSync(`${process.cwd()}/package.json`, "utf8")) as { version: string };
  expect(VERSION).toBe(pkg.version);
});
