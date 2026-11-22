<p align="center">
  <a href="https://rendobar.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://cdn.rendobar.com/assets/brand/logo-mark.svg">
      <img alt="Rendobar" src="https://cdn.rendobar.com/assets/brand/logo-mark-black.svg" width="80">
    </picture>
  </a>
</p>

<h1 align="center">Rendobar TypeScript packages</h1>

<p align="center">
  <strong>The official TypeScript framework packages for Rendobar's media processing and AI generation API.</strong>
</p>

<p align="center">
  <a href="https://rendobar.com/docs/sdk">Docs</a> &nbsp;·&nbsp;
  <a href="https://rendobar.com/integrations/typescript-sdk/">Guide</a> &nbsp;·&nbsp;
  <a href="https://api.rendobar.com/reference">API reference</a> &nbsp;·&nbsp;
  <a href="https://www.npmjs.com/package/@rendobar/sdk">npm</a> &nbsp;·&nbsp;
  <a href="https://app.rendobar.com">Get an API key</a> &nbsp;·&nbsp;
  <a href="https://discord.com/invite/kAGqjBzx8N">Discord</a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/license/rendobar/rendobar-typescript?style=flat-square&color=059669" alt="License">
</p>

The official TypeScript framework packages for Rendobar's media processing and AI generation API, built on [`@rendobar/sdk`](https://www.npmjs.com/package/@rendobar/sdk). Use them to submit a job from a NestJS app or an AI agent and get back a hosted URL, with the SDK's types, retries and idempotent submits.

| Package | What it does |
|---|---|
| [`@rendobar/nestjs`](packages/nestjs) | An injectable Rendobar client, webhook verification and a filter that keeps Rendobar errors out of responses, for NestJS apps. |
| [`@rendobar/agent-toolkit`](packages/agent-toolkit) | Media processing and AI generation tools for AI agents on the Vercel AI SDK, Mastra and LangChain.js. |

Both read `RENDOBAR_API_KEY` from the environment when you pass no key. Get one at [app.rendobar.com](https://app.rendobar.com).

## How these packages are tested

Every Rendobar SDK runs the same conformance scenarios from [rendobar/openapi](https://github.com/rendobar/openapi): retries, typed errors, request ids, keyed submits that a retry cannot duplicate, and deprecation notices. CI runs them here against a mock built from the published OpenAPI spec, on Node 22 and 24.

```bash
pnpm install
pnpm test
```

## Examples

[`examples/`](examples) holds a NestJS app, an AI SDK agent, and routes for Next.js, Express and Hono that submit a job and verify Rendobar's webhook.

## Other Rendobar SDKs

- TypeScript: [`@rendobar/sdk`](https://www.npmjs.com/package/@rendobar/sdk) on npm, the client these packages build on.
- Python: [`rendobar`](https://pypi.org/project/rendobar/) on PyPI.
- Go: [`github.com/rendobar/rendobar-go`](https://pkg.go.dev/github.com/rendobar/rendobar-go) on pkg.go.dev.
- NestJS: [`@rendobar/nestjs`](https://www.npmjs.com/package/@rendobar/nestjs), from this repository.
- Agent toolkit: [`@rendobar/agent-toolkit`](https://www.npmjs.com/package/@rendobar/agent-toolkit), from this repository.

## Versioning and support

Each package follows semantic versioning. While a package is at 0.x, a minor release may tighten types, and the changelog says so when one does. Deprecations are announced before anything is removed. See the [versioning policy](https://rendobar.com/docs/support/versioning) and the [changelog](https://rendobar.com/changelog/).

Report a bug in [issues](https://github.com/rendobar/rendobar-typescript/issues), or ask on [Discord](https://discord.com/invite/kAGqjBzx8N).

## License

[MIT](LICENSE). Rendobar is a product of Craftobar LLC.
