import type OpenAI from "openai";
import { z } from "zod";
import { Agent } from "../loop.js";
import { buildSubagentPrompt } from "../prompts.js";
import { describeArgs } from "../format.js";
import { defineTool, ToolError } from "./types.js";
import { readFile } from "./readFile.js";
import { listFiles } from "./listFiles.js";
import { grep } from "./grep.js";
import { bash } from "./bash.js";

// Hands a research job to a fresh agent with its own context, so the main conversation only gets the report.
// The subagent can read and search, and run commands on the safe list; anything else is refused.
export function taskTool(client: OpenAI, model: string) {
  return defineTool({
    name: "task",
    description:
      "Start a subagent to research something and report back, e.g. 'find where auth tokens are checked and how'. " +
      "It has its own context and read-only tools, so use it for broad searches that would otherwise fill your context. " +
      "Give it a complete, self-contained prompt; it can't see this conversation.",
    risk: "read",
    schema: z.object({
      description: z.string().describe("3-6 word summary shown to the user"),
      prompt: z.string().describe("Everything the subagent needs to know to do the job"),
    }),
    async execute({ prompt }, { signal, onProgress }) {
      const sub = new Agent({
        client,
        model,
        tools: [readFile, listFiles, grep, bash],
        system: buildSubagentPrompt(),
        maxSteps: 15,
      });
      const report = await sub.run(
        prompt,
        {
          onText() {},
          onToolCall: (name, args) => onProgress?.(`${name} ${describeArgs(name, args)}`),
          onToolResult() {},
          onBlocked: (name, reason) => onProgress?.(`${name} blocked: ${reason}`),
          confirm: async () => "no",
        },
        signal,
      );
      if (signal?.aborted) throw new ToolError("Interrupted by the user.");
      return report.trim() || "(the subagent returned no report)";
    },
  });
}
