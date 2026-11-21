# Notes for coding agents

- Packages live in `packages/*` and build on `@rendobar/sdk`. Do not reimplement API calls: call the SDK.
- Every package sends `X-Rendobar-Client: <name>/<version>`. The version comes from `src/version.ts`, which release-please bumps, and a test fails if it drifts from `package.json`.
- Commits follow Conventional Commits with the package as scope (`feat(nestjs): ...`). release-please reads them.
- `pnpm test` needs the conformance mock from rendobar/openapi on `RENDOBAR_MOCK` (CI starts it).
- Agent tools return errors as data (`{ error: { code, message } }`), never throw into the agent loop.
