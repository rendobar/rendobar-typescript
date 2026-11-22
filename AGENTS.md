# Notes for coding agents

- Packages live in `packages/*` and build on `@rendobar/sdk`. Do not reimplement API calls: call the SDK.
- Every package sends `X-Rendobar-Client: <name>/<version>`. The version comes from `src/version.ts`, which release-please bumps, and a test fails if it drifts from `package.json`.
- Commits follow Conventional Commits with the package as scope (`feat(nestjs): ...`). release-please reads them.
- `pnpm test` needs the conformance mock from rendobar/openapi on `RENDOBAR_MOCK` (CI starts it).
- Agent tools return errors as data (`{ error: { code, message, requestId } }`), never throw into the agent loop, and check their own input so every framework reports a mismatch the same way.
- Every `ts` block in a package README is compiled by `pnpm readmes` (CI runs it). Write each block as a complete file. A first line like `// app.module.ts` names it, so another block can import it.
