import type OpenAI from "openai";
import type { Msg } from "./loop.js";
import { truncate } from "./tools/types.js";

const SUMMARY_PROMPT = `You are summarizing a conversation between a user and a coding agent, so the agent can keep working after the older messages are removed.

Write short bullet points covering:
- What the user asked for, and any preferences or constraints they stated
- Decisions made and why
- Files read or changed (exact paths) and what changed in them
- Commands run and their results, including errors and how they were fixed
- What is finished and what is still left to do

Keep paths, names and numbers exact. Leave out small talk.`;

// Rough token count: about 4 characters per token is close enough to decide when to compact.
export function estimateTokens(messages: Msg[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

function textOf(m: Msg): string {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) return m.content.map((p: any) => p.text ?? "").join("");
  return "";
}

function render(m: Msg): string {
  const text = textOf(m);
  if (m.role === "tool") return `[tool result]\n${truncate(text, 2000)}`;
  if (m.role === "assistant") {
    const calls = (m.tool_calls ?? [])
      .map((c) => (c.type === "function" ? `[called ${c.function.name} ${truncate(c.function.arguments, 500)}]` : ""))
      .join("\n");
    return `[assistant]\n${text}\n${calls}`.trim();
  }
  return `[${m.role}]\n${text}`;
}

// Where to cut: everything from the returned index on is kept as is. It never lands on a tool
// result, which would separate it from its call. Returns -1 when there is nothing to summarize.
export function splitPoint(messages: Msg[], keepTokens: number): number {
  let best = -1;
  let lastValid = -1;
  let tail = 0;
  for (let i = messages.length - 1; i >= 2; i--) {
    tail += estimateTokens([messages[i]]);
    if (messages[i].role === "tool") continue;
    if (lastValid === -1) lastValid = i;
    if (tail > keepTokens) break;
    best = i;
  }
  return best === -1 ? lastValid : best;
}

// Replaces older messages with a summary. Returns null when the conversation is too short to compact.
export async function compactMessages(
  client: OpenAI,
  model: string,
  messages: Msg[],
  keepTokens: number,
  signal?: AbortSignal,
): Promise<Msg[] | null> {
  const split = splitPoint(messages, keepTokens);
  if (split < 2) return null;

  const transcript = truncate(messages.slice(1, split).map(render).join("\n\n"), 200_000);
  const res = await client.chat.completions.create(
    {
      model,
      messages: [
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: transcript },
      ],
    },
    { signal },
  );
  const summary = res.choices[0]?.message?.content?.trim();
  if (!summary) throw new Error("the model returned an empty summary");

  return [
    messages[0],
    { role: "user", content: `${SUMMARY_MARKER}\n\n${summary}` },
    ...messages.slice(split),
  ];
}

export const SUMMARY_MARKER = "[Summary of the earlier conversation, written when it got too long]";
