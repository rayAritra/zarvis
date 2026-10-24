import OpenAI from "openai";
import { toolSchemas, getTool, parseArgs, runTool } from "./tools/index.js";
import { Permissions } from "./permissions.js";
import { buildSystemPrompt } from "./prompts.js";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type Answer = "yes" | "no" | "always";
export type Confirm = (question: string, canAlways: boolean) => Promise<Answer>;

const client = new OpenAI({ baseURL: process.env.BASE_URL, apiKey: process.env.API_KEY });
const permissions = new Permissions();

const messages: Msg[] = [{ role: "system", content: buildSystemPrompt() }];

export async function runTurn(userInput: string, confirm: Confirm) {
  messages.push({ role: "user", content: userInput });

  for (let step = 0; step < 25; step++) {
    const res = await client.chat.completions.create({
      model: process.env.MODEL!,
      messages,
      tools: toolSchemas,
    });

    const msg = res.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      console.log(`\n${msg.content ?? ""}\n`);
      return;
    }

    for (const call of msg.tool_calls) {
      if (call.type !== "function") continue;
      const result = await handleCall(call.function.name, call.function.arguments, confirm);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  console.log("Stopped after 25 steps.");
}

async function handleCall(name: string, rawArgs: string, confirm: Confirm): Promise<string> {
  const tool = getTool(name);
  if (!tool) return `Error: unknown tool "${name}".`;

  let args: any;
  try {
    args = parseArgs(tool, rawArgs);
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }

  console.log(`  → ${name} ${JSON.stringify(args).slice(0, 120)}`);

  const verdict = permissions.check(tool, args);
  if (verdict.decision === "deny") {
    console.log(`  ✗ blocked: ${verdict.reason}`);
    return `Error: blocked by the user's safety rules (${verdict.reason}). Do not try to work around this.`;
  }

  if (verdict.decision === "ask") {
    if (tool.preview) {
      try {
        console.log(await tool.preview(args));
      } catch (e) {
        return `Error: ${(e as Error).message}`;
      }
    }
    const always = verdict.ruleLabel ? `, a = always allow ${verdict.ruleLabel}` : "";
    const answer = await confirm(`  Allow ${name}? (y = yes, n = no${always}) `, !!verdict.rule);
    if (answer === "no") return "The user denied this action. Ask them how they want to proceed.";
    if (answer === "always" && verdict.rule) permissions.remember(verdict.rule);
  }

  return runTool(tool, args);
}
