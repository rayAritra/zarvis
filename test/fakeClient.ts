import type OpenAI from "openai";

// A scripted stand-in for the model. Each reply is either text or a list of tool calls.
// String args are sent as is, to test malformed JSON.
export type Reply = string | { tool: string; args: object | string }[];

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    if (ms === 0) return resolve(); // Windows timers tick every ~15ms, which adds up over long replies
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(new Error("aborted"))), { once: true });
  });

async function* streamReply(reply: Reply, delayMs: number, signal?: AbortSignal) {
  if (typeof reply === "string") {
    for (const word of reply.match(/\S+\s*/g) ?? []) {
      await sleep(delayMs, signal);
      yield { choices: [{ delta: { content: word } }] };
    }
    return;
  }
  for (const [index, call] of reply.entries()) {
    const args = typeof call.args === "string" ? call.args : JSON.stringify(call.args);
    const half = Math.floor(args.length / 2);
    await sleep(delayMs, signal);
    yield { choices: [{ delta: { tool_calls: [{ index, id: `call_${index}`, function: { name: call.tool, arguments: args.slice(0, half) } }] } }] };
    yield { choices: [{ delta: { tool_calls: [{ index, function: { arguments: args.slice(half) } }] } }] };
  }
}

// Streaming requests get the scripted replies in order; non-streaming ones (compaction) get `summary`.
export function fakeClient(replies: Reply[], { delayMs = 0, summary = "- summary of earlier work" } = {}) {
  const requests: any[] = [];
  const client = {
    chat: {
      completions: {
        async create(params: any, options?: { signal?: AbortSignal }) {
          requests.push(structuredClone(params));
          if (!params.stream) return { choices: [{ message: { role: "assistant", content: summary } }] };
          return streamReply(replies.shift() ?? "(no more scripted replies)", delayMs, options?.signal);
        },
      },
    },
  };
  return { client: client as unknown as OpenAI, requests };
}
