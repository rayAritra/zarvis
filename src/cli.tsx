import { parseArgs } from "node:util";
import { render } from "ink";
import OpenAI from "openai";
import { loadConfig } from "./config.js";
import { Agent } from "./loop.js";
import { Session } from "./session.js";
import { tools } from "./tools/index.js";
import { taskTool } from "./tools/task.js";
import { runHeadless, readStdin } from "./headless.js";
import { App } from "./ui/App.js";
import { historyEntries } from "./ui/history.js";
import type { Entry } from "./ui/parts.js";

const HELP = `Usage: zarvis [options]

Options:
  -p, --print <prompt>  Run one prompt without the UI and print the answer.
                        Piped input is added to the prompt: cat log.txt | zarvis -p "explain"
  -y, --yes             With -p: approve every action that isn't blocked. Careful.
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
      print: { type: "string", short: "p" },
      yes: { type: "boolean", short: "y" },
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

const headless = flags.print !== undefined;
if (!headless && !process.stdin.isTTY) fail("zarvis needs an interactive terminal. Use -p to run a single prompt.");

const cwd = process.cwd();
// Free models often answer 429 when busy; a few retries with backoff usually get through.
const client = new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey, maxRetries: 4 });
const agent = new Agent({
  client,
  model: config.model,
  tools: [...tools, taskTool(client, config.model)],
  contextTokens: config.contextTokens,
  denyMessage: headless
    ? "Not run: this action needs approval, and this is a non-interactive run (-p without --yes). Don't retry it; tell the user what you would have done and that they can rerun with --yes."
    : undefined,
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

if (headless) {
  let prompt = flags.print!.trim();
  if (!process.stdin.isTTY) {
    const piped = (await readStdin()).trim();
    if (piped) prompt = prompt ? `${prompt}\n\n<stdin>\n${piped}\n</stdin>` : piped;
  }
  if (!prompt) fail("Nothing to do: give a prompt after -p, or pipe one in.");
  process.exitCode = await runHeadless(agent, prompt, { yes: !!flags.yes, session });
} else {
  const app = render(<App agent={agent} model={config.model} session={session} intro={intro} />, { exitOnCtrlC: false });
  await app.waitUntilExit();
}
