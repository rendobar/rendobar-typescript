// RENDOBAR_API_KEY=rb_... npm start
import { createClient } from "@rendobar/sdk";
import { runEditor, SAMPLE_VIDEO, trimRequest } from "./agent.js";
import { scriptedEditor } from "./editor-model.js";

const baseUrl = process.env["RENDOBAR_API_URL"];
const client = createClient(baseUrl === undefined ? {} : { baseUrl });

const { text } = await runEditor({ model: scriptedEditor(), client, prompt: trimRequest(SAMPLE_VIDEO) });
console.log(text);
