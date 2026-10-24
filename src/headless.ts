import type { Agent, AgentEvents } from "./loop.js";
import type { Session } from "./session.js";
import { describeArgs, describeResult } from "./format.js";

// Runs one prompt without the UI: the answer goes to stdout, progress to stderr, so output can be piped.
// Nobody is there to approve actions, so they're refused unless `yes` is set. Blocked commands stay blocked.
export async function runHeadless(agent: Agent, prompt: string, opts: { yes: boolean; session: Session }): Promise<number> {
  const ac = new AbortController();
  process.on("SIGINT", () => ac.abort());
  const log = (s: string) => process.stderr.write(s + "\n");

  let text = "";
  const ev: AgentEvents = {
    onText(delta) {
      text += delta;
      process.stdout.write(delta);
    },
    onToolCall(name, args) {
      if (text && !text.endsWith("\n")) process.stdout.write("\n");
      text = "";
      log(`→ ${name} ${describeArgs(name, args)}`);
    },
    onToolResult: (name, result) => log(`  ${describeResult(name, result)}`),
    onToolProgress: (_name, line) => log(`    ↳ ${line}`),
    onBlocked: (name, reason) => log(`✗ ${name} blocked: ${reason}`),
    onCompact: (before, after) => log(`(compacted the conversation: ~${before} → ~${after} tokens)`),
    async confirm(req) {
      if (opts.yes) return "yes";
      log(`✗ ${req.tool} needs approval, so it was skipped. Run with --yes to allow actions like this.`);
      return "no";
    },
  };

  try {
    await agent.run(prompt, ev, ac.signal);
    if (text && !text.endsWith("\n")) process.stdout.write("\n");
    return ac.signal.aborted ? 130 : 0;
  } catch (err) {
    log(`Error: ${(err as Error).message}`);
    return 1;
  } finally {
    opts.session.save(agent.messages);
  }
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
