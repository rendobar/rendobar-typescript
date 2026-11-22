/**
 * A scripted language model, so the example runs with no provider key and
 * costs no tokens. It is the AI SDK's own test model: generateText validates
 * its tool calls, runs the tools and feeds the results back exactly as it does
 * for a real model. Swap scriptedEditor() for a real one, such as
 * "openai/gpt-4o" through the AI Gateway.
 */
import { MockLanguageModelV4 } from "ai/test";

type Prompt = Parameters<MockLanguageModelV4["doGenerate"]>[0]["prompt"];
type Turn = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

/** The model's turn when it calls one tool. */
export function toolCall(toolCallId: string, toolName: string, input: object): Turn {
  return {
    content: [{ type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: "tool-calls", raw: undefined },
    usage,
    warnings: [],
  };
}

/** The model's last turn: its answer. */
export function answer(text: string): Turn {
  return { content: [{ type: "text", text }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
}

/** Reads one field of a JSON value, as a model reads a tool result. */
export function field(value: unknown, ...path: Array<string | number>): unknown {
  let at = value;
  for (const key of path) at = typeof at === "object" && at !== null ? Reflect.get(at, key) : undefined;
  return at;
}

type Seen = { tool: string; result: unknown };

/** Every tool result the model has been given so far, in order. */
function toolResults(prompt: Prompt): Seen[] {
  return prompt.flatMap((message) =>
    message.role === "tool"
      ? message.content.flatMap((part) => (part.type === "tool-result" && part.output.type === "json" ? [{ tool: part.toolName, result: part.output.value }] : []))
      : [],
  );
}

function userText(prompt: Prompt): string {
  return prompt.flatMap((message) => (message.role === "user" ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])) : [])).join("\n");
}

/**
 * The calls a model makes for "probe this video, then trim it to its first 2
 * seconds and give me the URL": look up the job types and ffmpeg's params,
 * probe, trim, read the finished job, answer. A tool failure ends the run with
 * the error, as a model would report it.
 */
function nextTurn(request: string, seen: Seen[]): Turn {
  const last = seen.at(-1);
  const failure = field(last?.result, "error", "code");
  if (last && typeof failure === "string") return answer(`I could not finish: ${last.tool} answered ${failure}.`);

  const url = /https?:\/\/\S+/.exec(request)?.[0];
  if (url === undefined) return answer("Send me the video's URL.");
  switch (seen.length) {
    case 0:
      return toolCall("call_1", "list_job_types", {});
    case 1:
      return toolCall("call_2", "list_job_types", { type: "ffmpeg" });
    case 2:
      return toolCall("call_3", "probe_media", { url });
    case 3:
      return toolCall("call_4", "run_job", { type: "ffmpeg", inputs: { "in.mp4": url }, params: { command: "-i in.mp4 -t 2 -c copy out.mp4" } });
    case 4:
      return toolCall("call_5", "get_job", { id: field(last?.result, "job", "id") });
    default: {
      const duration = field(seen[2]?.result, "job", "data", "summary", "durationSec");
      const length = typeof duration === "number" ? `${duration.toFixed(1)} s long` : "of unknown length";
      return answer(`The video is ${length}. Its first 2 seconds: ${String(field(last?.result, "job", "url"))}`);
    }
  }
}

export function scriptedEditor(): MockLanguageModelV4 {
  return new MockLanguageModelV4({ doGenerate: async ({ prompt }) => nextTurn(userText(prompt), toolResults(prompt)) });
}
