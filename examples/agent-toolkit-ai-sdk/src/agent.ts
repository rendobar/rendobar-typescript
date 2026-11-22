import { rendobarTools } from "@rendobar/agent-toolkit/ai-sdk";
import type { RendobarClient } from "@rendobar/sdk";
import { generateText, stepCountIs, type LanguageModel } from "ai";

export const SAMPLE_VIDEO = "https://cdn.rendobar.com/assets/examples/sample.mp4";

export const trimRequest = (url: string) => `Probe this video, then trim it to its first 2 seconds and give me the URL: ${url}`;

const SYSTEM =
  "You edit videos with Rendobar's tools. Check the live job types and the job's params before you run one, probe a video before you edit it, and answer with the output URL.";

export type EditorRun = {
  model: LanguageModel;
  client: RendobarClient;
  prompt: string;
  abortSignal?: AbortSignal | undefined;
};

/** One agent run: the model calls Rendobar's tools until it can answer. */
export function runEditor({ model, client, prompt, abortSignal }: EditorRun) {
  return generateText({
    model,
    system: SYSTEM,
    tools: rendobarTools({ client }),
    stopWhen: stepCountIs(8),
    prompt,
    ...(abortSignal === undefined ? {} : { abortSignal }),
  });
}
