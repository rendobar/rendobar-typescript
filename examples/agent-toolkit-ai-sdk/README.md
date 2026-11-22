# Video-editing agent with @rendobar/agent-toolkit

An AI SDK agent that handles "Probe this video, then trim it to its first 2 seconds and give me the URL". It looks up the live job types and ffmpeg's params, probes the video, runs the trim, reads the finished job and answers with the output URL.

The model is the AI SDK's scripted test model, so the example needs no provider key and spends no tokens. It reads each tool result the way a model would. To use a real model, pass one to `runEditor`, such as `"openai/gpt-4o"` through the AI Gateway.

| File | What it shows |
|---|---|
| [`src/agent.ts`](src/agent.ts) | `generateText` with `rendobarTools()` from `@rendobar/agent-toolkit/ai-sdk` |
| [`src/editor-model.ts`](src/editor-model.ts) | The scripted model, built on `MockLanguageModelV4` from `ai/test` |
| [`test/agent.test.ts`](test/agent.test.ts) | All four tools, input refusals, `asset://` and `storage://` inputs, cancellation, and the LangChain.js adapter |

## Run it

```bash
npm install
RENDOBAR_API_KEY=rb_... npm start
```

It runs one ffprobe job and one ffmpeg job on a 2-second cut. `RENDOBAR_API_URL` points the client at another API server.

## Test it

`npm test` builds the example and runs the tests. It needs `RENDOBAR_API_URL` and `RENDOBAR_API_KEY`. Against a real API it runs three ffprobe jobs and one 2-second ffmpeg trim, and cancels the job it stops waiting for. From the repository root, `node examples/run.mjs` runs it against the conformance mock.
