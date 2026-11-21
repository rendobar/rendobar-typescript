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

In a LangGraph tool node, look tools up by name:

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

## The tools

| Tool | What the agent can do |
|---|---|
| `list_job_types` | See every live job type, or one type's params schema |
| `run_job` | Run a job and get back its output URL, files and data |
| `get_job` | Check a job's status and output |
| `probe_media` | Read a file's duration, format, streams and resolution |

`list_job_types`, `get_job` and `probe_media` do what the tools of the same name on Rendobar's MCP server do. `run_job` is the MCP server's `submit_job` followed by a wait for the result, so an agent gets the output in one call. Pass `wait: false` to get the created job back at once. The job list is read live, so a new job type reaches your agent with no upgrade.

`probe_media`, and `get_job` on an ffprobe job, return ffprobe's summary and any warnings, which is what an agent needs to plan an edit. Call `get_job` with `raw: true` for every raw ffprobe section.

For an agent that speaks MCP (the OpenAI Agents SDK, the Claude Agent SDK, Mastra), connect `https://api.rendobar.com/mcp` instead.

## Errors and retries

Errors come back to the model as data, never as a thrown exception that would end the agent loop. An API refusal looks like `{ error: { code, message, requestId } }`.

Every `run_job` call sends an idempotency key. When a submit fails before Rendobar answers (a dropped connection, a 5xx or a 429), the result also carries the `idempotencyKey` it used. The model can call `run_job` again with that key and the same type, params and inputs, and Rendobar returns the job the first call created instead of starting a second one.

Reusing a key with a different type, params or inputs is refused with a 409. The model gets `{ error: { code: "CONFLICT", message, requestId } }` and no key to retry with. The message names the job the key already belongs to. To run the new request, call `run_job` without `idempotencyKey`.

Once a job exists, a wait that fails returns the job id and a hint to call `get_job`, so the model checks on that job instead of paying for a second one.

MIT. Rendobar is a product of Craftobar LLC.
