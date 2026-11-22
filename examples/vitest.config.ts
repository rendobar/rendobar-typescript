import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Every file talks to the one shared conformance mock and resets it, so files
    // must not run at the same time or one file's reset lands inside another's test.
    fileParallelism: false,
    // The project folders (nestjs-app, ...) have their own installs and tests; examples/run.mjs runs them.
    include: ["test/**/*.test.ts"],
  },
});
