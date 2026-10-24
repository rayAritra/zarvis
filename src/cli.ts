import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import OpenAI from "openai";
import { Agent, type AgentEvents } from "./loop.js";

const rl = readline.createInterface({ input, output });
const agent = new Agent({
  client: new OpenAI({ baseURL: process.env.BASE_URL, apiKey: process.env.API_KEY }),
  model: process.env.MODEL!,
});

// Tracks whether the cursor is at the start of a line, so tool lines never get glued onto streamed text.
let atLineStart = true;
const write = (s: string) => {
  if (!s) return;
  output.write(s);
  atLineStart = s.endsWith("\n");
};
const line = (s: string) => write((atLineStart ? "" : "\n") + s + "\n");
const firstLine = (s: string) => s.split("\n")[0].slice(0, 100);

const events: AgentEvents = {
  onText: write,
  onToolCall: (name, args) => line(`  → ${name} ${JSON.stringify(args).slice(0, 120)}`),
  onToolResult: (_name, result) => line(`    ${firstLine(result)}`),
  onBlocked: (_name, reason) => line(`  ✗ blocked: ${reason}`),
  async confirm(req, signal) {
    if (req.preview) line(req.preview);
    const always = req.ruleLabel ? `, a = always allow ${req.ruleLabel}` : "";
    const a = (await rl.question(`  Allow ${req.tool}? (y = yes, n = no${always}) `, { signal })).trim().toLowerCase();
    atLineStart = true;
    if (a.startsWith("a") && req.ruleLabel) return "always";
    return a.startsWith("y") ? "yes" : "no";
  },
};

// Ctrl+C stops the running turn; at an idle prompt it quits.
let turn: AbortController | null = null;
const onInterrupt = () => {
  if (turn) turn.abort();
  else rl.close();
};
rl.on("SIGINT", onInterrupt);
process.on("SIGINT", onInterrupt);

console.log("my-agent ready. Ctrl+C stops a running task, or quits at the prompt.");

while (true) {
  let text: string;
  try {
    text = (await rl.question("> ")).trim();
  } catch {
    break; // input closed
  }
  if (!text) continue;
  if (text === "exit") break;

  turn = new AbortController();
  try {
    await agent.run(text, events, turn.signal);
    if (turn.signal.aborted) line("[interrupted]");
  } catch (err) {
    line(`Error: ${(err as Error).message}`);
  } finally {
    turn = null;
    line("");
  }
}

rl.close();
