# @rendobar/agent-toolkit

Rendobar tools for AI agent frameworks. Give an agent the ability to process video, audio and images, burn captions, compose edits and generate images, with one import.

```bash
npm install @rendobar/agent-toolkit @rendobar/sdk ai zod
```

## Vercel AI SDK

```ts
import { generateText, stepCountIs } from "ai";
import { rendobarTools } from "@rendobar/agent-toolkit/ai-sdk";

const { text } = await generateText({
  model,
  tools: rendobarTools(), // reads RENDOBAR_API_KEY
  stopWhen: stepCountIs(5),
  prompt: "Cut https://cdn.rendobar.com/assets/examples/sample.mp4 to its first 5 seconds and give me the link.",
});
```

## The tools

| Tool | What the agent can do |
|---|---|
| `list_job_types` | See every live job type, or one type's params schema |
| `run_job` | Run a job and get back its output URL, files and data |
| `get_job` | Check a job's status and output |
| `probe_media` | Read a file's duration, format, streams and resolution |

They are the same tools as Rendobar's MCP server, so an agent behaves the same either way. The job list is read live, so a new job type reaches your agent with no upgrade. API errors come back to the model as `{ error: { code, message, requestId } }` it can act on, and every submit is safe to retry.

For an agent that speaks MCP (the OpenAI Agents SDK, the Claude Agent SDK, Mastra), connect `https://api.rendobar.com/mcp` instead.

MIT. Rendobar is a product of Craftobar LLC.
