# @rendobar/agent-toolkit

Rendobar tools for AI agent frameworks: the Vercel AI SDK, Mastra and LangChain.js. Give an agent the ability to process video, audio and images, burn captions, compose edits and generate images, with one import.

```bash
npm install @rendobar/agent-toolkit @rendobar/sdk zod ai
```

The tools read `RENDOBAR_API_KEY`. The tool schemas are Zod 4 schemas, so the toolkit needs `zod` 4.

## Vercel AI SDK

```ts
import { generateText, stepCountIs } from "ai";
import { rendobarTools } from "@rendobar/agent-toolkit/ai-sdk";

const { text } = await generateText({
  model: "openai/gpt-4o",
  tools: rendobarTools(),
  stopWhen: stepCountIs(5),
  prompt: "Cut https://cdn.rendobar.com/assets/examples/sample.mp4 to its first 5 seconds and give me the link.",
});
```

## Mastra

```ts
import { Agent } from "@mastra/core/agent";
import { rendobarTools } from "@rendobar/agent-toolkit/mastra";

const editor = new Agent({
  id: "editor",
  name: "Editor",
  instructions: "You edit videos.",
  model: "openai/gpt-4o",
  tools: rendobarTools(),
});
```

## LangChain.js and LangGraph.js

```ts
import { createAgent } from "langchain";
import { rendobarTools } from "@rendobar/agent-toolkit/langchain";

const agent = createAgent({ model: "openai:gpt-4o", tools: rendobarTools() });
```

`rendobarTools()` returns a plain list of tools that all have one type. Find a tool by its `name`, not by its place in the list. In a LangGraph tool node:

```ts
import type { AIMessage } from "@langchain/core/messages";
import { rendobarTools } from "@rendobar/agent-toolkit/langchain";

const tools = rendobarTools();
const toolsByName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

async function runTools(message: AIMessage) {
  return Promise.all((message.tool_calls ?? []).map((call) => toolsByName[call.name]?.invoke(call)));
}
```

Install only the framework you use: `ai`, `@mastra/core` and `@langchain/core` are optional peer dependencies.

## Options

Every adapter takes one options object with one option, `client`: a client made with `createClient` from `@rendobar/sdk`. Pass one to use a key other than `RENDOBAR_API_KEY`, another API server, or your own timeout and retry settings.

```ts
import { createClient } from "@rendobar/sdk";
import { rendobarTools } from "@rendobar/agent-toolkit/ai-sdk";

const apiKey = process.env["RENDOBAR_KEY_FOR_AGENTS"];
if (!apiKey) throw new Error("Set RENDOBAR_KEY_FOR_AGENTS");

const tools = rendobarTools({
  client: createClient({ apiKey, baseUrl: "https://api.rendobar.com", timeout: 60_000 }),
});
```

Without `client`, the toolkit builds a client that reads `RENDOBAR_API_KEY`. If that is unset, `run_job`, `get_job` and `probe_media` return a `MISSING_API_KEY` error that names it. `list_job_types` needs no key.

## The tools

| Tool | What the agent can do |
|---|---|
| `list_job_types` | See every live job type, or one type's params schema and input names |
| `run_job` | Run a job and get back its output URL, files and data |
| `get_job` | Check a job's status and output |
| `probe_media` | Read a file's duration, format, streams and resolution |

`list_job_types`, `get_job` and `probe_media` do what the tools of the same name on Rendobar's MCP server do. `run_job` is the MCP server's `submit_job` followed by a wait for the result, so an agent gets the output in one call. Pass `wait: false` to get the created job back at once. The job list is read live, so a new job type reaches your agent with no upgrade.

`probe_media` takes an `http` or `https` URL with no whitespace, quotes or backslashes, so the URL reaches ffprobe as exactly one argument. `run_job`'s `inputs` take the same kind of URL, or an uploaded asset (`asset://asset_...`) or a file in a connected bucket (`storage://<storage id>/<path>`). Any other form, such as `file:`, `javascript:` or `data:`, is refused before a request. It, and `get_job` on an ffprobe job, return ffprobe's summary and any warnings, which is what an agent needs to plan an edit. Call `get_job` with `raw: true` for every raw ffprobe section.

A params schema that would crowd the model's context (compose's is about 150 KB) comes back shortened, with `trimmed` and a `hint` saying so. Call `list_job_types` with the type and `full: true` for the whole schema.

A job's `cost` is `{ amount, currency, formatted }`, where `amount` is integer nanodollars (1 USD is 1,000,000,000) and `formatted` reads like `$0.0010`. It appears once billing settles, which is just after the job completes. A result read at completion may have no `cost` yet, and its `hint` says to call `get_job` later.

## Results

Every tool returns a typed result. Import the types from `@rendobar/agent-toolkit`.

| Tool | Result |
|---|---|
| `run_job`, `get_job`, `probe_media` | `{ job, hint? }`, where `job` is a `JobSummary` |
| `list_job_types` | `{ jobTypes }`, or for one type `{ type, params, inputs, trimmed?, hint? }` |
| any tool, on failure | `{ error, id?, status?, hint? }` |

`isToolFailure(result)` tells a failure from a result. A `JobSummary` is told apart by `status`: a `complete` job has `url`, `files` and `data`, a `failed` job has its own `error`, and a status this version does not know yet arrives as `status: "unknown"` with `reportedStatus`. A failed job is a successful read, so its error is `job.error`, never the top-level `error`.

## Cancellation

Each adapter passes its framework's abort signal through: the AI SDK's `abortSignal`, Mastra's `abortSignal` and LangChain's `signal`. When a run is cancelled, the tools stop polling. A `run_job` cancelled after its job was created returns `ABORTED` with the job's id and last known status in every framework, LangChain included, since the job keeps running on Rendobar. Calling a definition directly takes the same signal: `run(input, { signal })`.

For an agent that speaks MCP (the OpenAI Agents SDK, the Claude Agent SDK, Mastra), connect `https://api.rendobar.com/mcp` instead.

## Errors and retries

Errors come back to the model as data, never as a thrown exception that would end the agent loop. Every error has one shape, `{ error: { code, message, requestId } }`, where `requestId` is null when no request answered. When the API lists what it refused (a `VALIDATION_ERROR`, `PLAN_LIMIT` or `FEATURE_NOT_ENABLED`), `error.problems` carries each one as `{ path, message }`, plus `upgradeTo` when a higher plan would allow it.

Input that does not match a tool's schema gets a `VALIDATION_ERROR` with the same `problems` list, before any request. The tools check input themselves rather than leaving it to the framework, so the AI SDK, Mastra and LangChain all report it the same way.

Every `run_job` call sends an idempotency key. When a submit fails before Rendobar answers (a dropped connection, a 5xx or a 429), `error.idempotencyKey` carries the key it sent. The model can call `run_job` again with that key and the same type, params and inputs, and Rendobar returns the job the first call created instead of starting a second one.

Reusing a key with a different type, params or inputs is refused with a 409. The model gets `{ error: { code: "CONFLICT", message, requestId } }` and no key to retry with. The message names the job the key already belongs to. To run the new request, call `run_job` without `idempotencyKey`.

Once a job exists, a wait that fails returns the job id and a hint to call `get_job`, so the model checks on that job instead of paying for a second one.

MIT. Rendobar is a product of Craftobar LLC.
