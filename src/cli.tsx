import "dotenv/config";
import { render } from "ink";
import OpenAI from "openai";
import { Agent } from "./loop.js";
import { App } from "./ui/App.js";

if (!process.stdin.isTTY) {
  console.error("my-agent needs an interactive terminal.");
  process.exit(1);
}

const model = process.env.MODEL!;
const agent = new Agent({
  client: new OpenAI({ baseURL: process.env.BASE_URL, apiKey: process.env.API_KEY }),
  model,
});

const app = render(<App agent={agent} model={model} />, { exitOnCtrlC: false });
await app.waitUntilExit();
