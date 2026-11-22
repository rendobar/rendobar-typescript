/**
 * Type-checks every ```ts block in every package README, against the package's
 * own source and the real types of the frameworks the block imports. A README
 * example that stops compiling fails CI here instead of in a user's editor.
 *
 *   pnpm readmes
 *
 * Each block is compiled as its own file, with the package's tsconfig, in a
 * scratch folder inside the package so imports resolve from its node_modules.
 * A block whose first line is a file name comment (`// app.module.ts`) is
 * compiled under that name, so one block can import another (`./app.module`).
 * The package's own name resolves to its src, so no build is needed first.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE_NAME = /^\/\/ ([\w.-]+\.ts)\r?\n/;
const BLOCK = /```ts\r?\n([\s\S]*?)```/g;

function snippets(readme: string): Array<{ name: string; code: string }> {
  return [...readme.matchAll(BLOCK)].map((m, i) => {
    const code = m[1] ?? "";
    return { name: FILE_NAME.exec(code)?.[1] ?? `snippet-${i + 1}.ts`, code };
  });
}

let failed = false;
for (const entry of readdirSync(join(root, "packages"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = join(root, "packages", entry.name);
  const { name } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const blocks = snippets(readFileSync(join(dir, "README.md"), "utf8"));
  if (blocks.length === 0) {
    console.error(`${name}: README has no ts blocks to check`);
    failed = true;
    continue;
  }

  // The package's own compiler, so the check uses the version its tests use.
  const ts: typeof import("typescript") = createRequire(join(dir, "package.json"))("typescript");
  const config = ts.readConfigFile(join(dir, "tsconfig.json"), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, dir);
  const scratch = join(dir, ".readme-snippets");
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch);
  try {
    const files = blocks.map((b) => {
      const file = join(scratch, b.name);
      writeFileSync(file, b.code);
      return file;
    });
    const compilerOptions = {
      ...options,
      noEmit: true,
      baseUrl: dir,
      paths: { [name]: ["./src/index.ts"], [`${name}/*`]: ["./src/*.ts"] },
    };
    // Type libraries (`types: ["node"]`) resolve from the current directory, which must be the package's.
    const host = { ...ts.createCompilerHost(compilerOptions), getCurrentDirectory: () => dir };
    const program = ts.createProgram(files, compilerOptions, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length > 0) {
      failed = true;
      console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => dir, getNewLine: () => "\n" }));
    }
    console.log(`${name}: ${blocks.length} README blocks, ${diagnostics.length} errors`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
