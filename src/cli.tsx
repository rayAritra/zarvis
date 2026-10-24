import { parseArgs } from "node:util";
import { render } from "ink";
import OpenAI from "openai";
import { loadConfig } from "./config.js";
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

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

let flags;
try {
  flags = parseArgs({
    options: {
      resume: { type: "boolean", short: "r" },
      session: { type: "string", short: "s" },
      help: { type: "boolean", short: "h" },
    },
  }).values;
} catch (err) {
  fail(`${(err as Error).message}\n\n${HELP}`);
}

if (flags.help) {
  console.log(HELP);
  process.exit(0);
}

let config;
try {
  config = loadConfig();
} catch (err) {
  fail((err as Error).message);
}

if (!process.stdin.isTTY) fail("my-agent needs an interactive terminal.");

const cwd = process.cwd();
const agent = new Agent({
  client: new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey }),
  model: config.model,
  contextTokens: config.contextTokens,
});

let session: Session;
const intro: Entry[] = [];
if (flags.session || flags.resume) {
  let found: Session | null;
  try {
    found = flags.session ? Session.load(flags.session) : Session.latest(cwd);
  } catch (err) {
    fail((err as Error).message);
  }
  if (!found) fail("No earlier session in this folder to resume.");
  session = found;
  agent.load(session.data.messages);
  intro.push(...historyEntries(session.data.messages));
  intro.push({ kind: "info", text: `Resumed session ${session.data.id}.` });
} else {
  session = Session.create(cwd, config.model);
}

const app = render(<App agent={agent} model={config.model} session={session} intro={intro} />, { exitOnCtrlC: false });
await app.waitUntilExit();
