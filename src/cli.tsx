import "dotenv/config";
import { parseArgs } from "node:util";
import { render } from "ink";
import OpenAI from "openai";
import { Agent } from "./loop.js";
import { Session } from "./session.js";
import { App } from "./ui/App.js";
import { historyEntries } from "./ui/history.js";
import type { Entry } from "./ui/parts.js";

const HELP = `Usage: my-agent [options]

Options:
  -r, --resume          Continue the most recent session in this folder
  -s, --session <id>    Continue a specific session
  -h, --help            Show this help`;

const { values: flags } = parseArgs({
  options: {
    resume: { type: "boolean", short: "r" },
    session: { type: "string", short: "s" },
    help: { type: "boolean", short: "h" },
  },
});

if (flags.help) {
  console.log(HELP);
  process.exit(0);
}

if (!process.stdin.isTTY) {
  console.error("my-agent needs an interactive terminal.");
  process.exit(1);
}

const model = process.env.MODEL!;
const cwd = process.cwd();
const agent = new Agent({
  client: new OpenAI({ baseURL: process.env.BASE_URL, apiKey: process.env.API_KEY }),
  model,
  contextTokens: Number(process.env.CONTEXT_TOKENS) || undefined,
});

let session: Session;
const intro: Entry[] = [];
if (flags.session || flags.resume) {
  const found = flags.session ? Session.load(flags.session) : Session.latest(cwd);
  if (!found) {
    console.error("No earlier session in this folder to resume.");
    process.exit(1);
  }
  session = found;
  agent.load(session.data.messages);
  intro.push(...historyEntries(session.data.messages));
  intro.push({ kind: "info", text: `Resumed session ${session.data.id}.` });
} else {
  session = Session.create(cwd, model);
}

const app = render(<App agent={agent} model={model} session={session} intro={intro} />, { exitOnCtrlC: false });
await app.waitUntilExit();
