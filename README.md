# Rendobar TypeScript packages

Framework packages for the [Rendobar API](https://rendobar.com), built on [`@rendobar/sdk`](https://www.npmjs.com/package/@rendobar/sdk).

| Package | What it does |
|---|---|
| [`@rendobar/nestjs`](packages/nestjs) | An injectable Rendobar client and a webhook signature guard for NestJS apps. |
| [`@rendobar/agent-toolkit`](packages/agent-toolkit) | Media processing and AI generation tools for AI agents on the Vercel AI SDK, Mastra and LangChain.js. |

Both read `RENDOBAR_API_KEY` from the environment when you pass no key. Get one at [app.rendobar.com](https://app.rendobar.com).

## How these packages are tested

Every Rendobar SDK runs the same conformance scenarios from [rendobar/openapi](https://github.com/rendobar/openapi): retries, typed errors, request ids, keyed submits that a retry cannot duplicate, and deprecation notices. CI runs them here against a mock built from the published OpenAPI spec, on Node 20, 22 and 24.

```bash
pnpm install
pnpm test
```

## Links

- Docs: [rendobar.com/docs](https://rendobar.com/docs)
- API reference: [api.rendobar.com/openapi.json](https://api.rendobar.com/openapi.json)
- Python SDK: [rendobar/rendobar-python](https://github.com/rendobar/rendobar-python)

MIT licensed. Rendobar is a product of Craftobar LLC.
