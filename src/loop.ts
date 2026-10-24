import type OpenAI from "openai";
import { tools as defaultTools, toolSchemas, parseArgs, runTool } from "./tools/index.js";
import type { Tool } from "./tools/types.js";
import { Permissions } from "./permissions.js";
import { buildSystemPrompt } from "./prompts.js";
import { compactMessages, estimateTokens } from "./compact.js";

export type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type Answer = "yes" | "no" | "always";

export interface ApprovalRequest {
  tool: string;
  args: any;
  preview?: string;
  ruleLabel?: string; // set when "always allow" is possible
}

// How the agent reports what it's doing. The terminal UI, headless mode and tests each implement this.
export interface AgentEvents {
  onText(delta: string): void;
  onToolCall(name: string, args: any): void;
  onToolResult(name: string, result: string): void;
  onToolProgress?(name: string, text: string): void;
  onBlocked(name: string, reason: string): void;
  confirm(req: ApprovalRequest, signal?: AbortSignal): Promise<Answer>;
  onCompact?(beforeTokens: number, afterTokens: number): void;
}

export interface AgentOptions {
  client: OpenAI;
  model: string;
  tools?: Tool<any>[];
  system?: string;
  maxSteps?: number;
  permissions?: Permissions;
  // The model's context window. Older messages are summarized at 75% of it.
  contextTokens?: number;
  // What the model is told when an action is refused.
  denyMessage?: string;
}

interface PendingCall {
  id: string;
  name: string;
  args: string;
}

export class Agent {
  messages: Msg[];
  readonly permissions: Permissions;
  private tools: Tool<any>[];
  private byName: Map<string, Tool<any>>;

  constructor(private opts: AgentOptions) {
    this.tools = opts.tools ?? defaultTools;
    this.byName = new Map(this.tools.map((t) => [t.name, t]));
    this.permissions = opts.permissions ?? new Permissions();
    this.messages = [{ role: "system", content: opts.system ?? buildSystemPrompt() }];
  }

  // Starts a new conversation. "Always allow" answers are kept.
  reset() {
    this.messages = [{ role: "system", content: this.opts.system ?? buildSystemPrompt() }];
  }

  // Continues a saved conversation, with a fresh system prompt (git status may have changed since).
  load(saved: Msg[]) {
    this.reset();
    this.messages.push(...saved.filter((m) => m.role !== "system"));
  }

  // Summarizes older messages. Returns false when there was too little to summarize.
  async compact(ev?: Pick<AgentEvents, "onCompact">, signal?: AbortSignal): Promise<boolean> {
    const limit = this.opts.contextTokens ?? 100_000;
    const before = estimateTokens(this.messages);
    const next = await compactMessages(this.opts.client, this.opts.model, this.messages, limit * 0.25, signal);
    if (!next) return false;
    this.messages = next;
    ev?.onCompact?.(before, estimateTokens(next));
    return true;
  }

  // Runs one user turn until the model stops calling tools. Returns the final answer text.
  // If the signal fires, the turn stops and the history is left valid for the next turn.
  async run(input: string, ev: AgentEvents, signal?: AbortSignal): Promise<string> {
    this.messages.push({ role: "user", content: input });
    const maxSteps = this.opts.maxSteps ?? 25;

    for (let step = 0; step < maxSteps; step++) {
      if (estimateTokens(this.messages) > (this.opts.contextTokens ?? 100_000) * 0.75) {
        try {
          await this.compact(ev, signal);
        } catch (err) {
          if (signal?.aborted) return "";
          throw new Error(`Couldn't compact the conversation: ${(err as Error).message}`);
        }
      }
      const { content, calls } = await this.callModel(ev, signal);
      if (signal?.aborted) return content;
      if (!calls.length) return content;

      const results = new Map<string, string>();
      try {
        for (const call of calls) {
          if (signal?.aborted) break;
          results.set(call.id, await this.handleCall(call, ev, signal));
        }
      } catch (err) {
        if (!signal?.aborted) throw err;
      } finally {
        // Every tool call needs a result, or the next request is rejected.
        for (const call of calls) {
          const content = results.get(call.id) ?? "Interrupted by the user before this ran.";
          this.messages.push({ role: "tool", tool_call_id: call.id, content });
        }
      }
      if (signal?.aborted) return "";
    }
    const note = `Stopped after ${maxSteps} steps.`;
    ev.onText(`\n${note}`);
    return note;
  }

  private async callModel(ev: AgentEvents, signal?: AbortSignal) {
    let content = "";
    const calls: PendingCall[] = [];

    try {
      const stream = await this.opts.client.chat.completions.create(
        { model: this.opts.model, messages: this.messages, tools: toolSchemas(this.tools), stream: true },
        { signal },
      );
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          content += delta.content;
          ev.onText(delta.content);
        }
        for (const tc of delta.tool_calls ?? []) {
          const c = (calls[tc.index] ??= { id: "", name: "", args: "" });
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.name ||= tc.function.name;
          if (tc.function?.arguments) c.args += tc.function.arguments;
        }
      }
    } catch (err) {
      if (!signal?.aborted) throw err;
      // Keep what was said so far, so the model knows where it was cut off.
      this.messages.push({ role: "assistant", content: `${content}\n[interrupted by the user]` });
      return { content, calls: [] };
    }

    const done = calls.filter(Boolean);
    done.forEach((c, i) => (c.id ||= `call_${Date.now()}_${i}`));
    this.messages.push({
      role: "assistant",
      content: content || null,
      ...(done.length && {
        tool_calls: done.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.args } })),
      }),
    });
    return { content, calls: done };
  }

  private async handleCall(call: PendingCall, ev: AgentEvents, signal?: AbortSignal): Promise<string> {
    const tool = this.byName.get(call.name);
    if (!tool) return `Error: unknown tool "${call.name}".`;

    let args: any;
    try {
      args = parseArgs(tool, call.args);
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }

    ev.onToolCall(tool.name, args);

    const verdict = this.permissions.check(tool, args);
    if (verdict.decision === "deny") {
      ev.onBlocked(tool.name, verdict.reason!);
      return `Error: blocked by the user's safety rules (${verdict.reason}). Do not try to work around this.`;
    }

    if (verdict.decision === "ask") {
      let preview: string | undefined;
      if (tool.preview) {
        try {
          preview = await tool.preview(args);
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      }
      const answer = await ev.confirm({ tool: tool.name, args, preview, ruleLabel: verdict.rule && verdict.ruleLabel }, signal);
      if (answer === "no") return this.opts.denyMessage ?? "The user denied this action. Ask them how they want to proceed.";
      if (answer === "always" && verdict.rule) this.permissions.remember(verdict.rule);
    }

    const result = await runTool(tool, args, { signal, onProgress: (text) => ev.onToolProgress?.(tool.name, text) });
    ev.onToolResult(tool.name, result);
    return result;
  }
}
