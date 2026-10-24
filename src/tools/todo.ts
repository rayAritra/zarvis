import { z } from "zod";
import { defineTool, ToolError } from "./types.js";

const TodoSchema = z.object({
  content: z.string().min(1).describe("What needs doing, as a short imperative"),
  status: z.enum(["pending", "in_progress", "completed"]),
});
export type Todo = z.infer<typeof TodoSchema>;

const mark = { pending: "[ ]", in_progress: "[>]", completed: "[x]" } as const;

// Has no side effects: the list lives in the conversation, and the UI draws it from the call's arguments.
export const todoWrite = defineTool({
  name: "todo_write",
  description:
    "Plan work that takes several steps as a checklist. Send the whole list every time; it replaces the old one. " +
    "Keep exactly one item in_progress while you work, and mark each item completed as soon as it's done.",
  risk: "read",
  schema: z.object({ todos: z.array(TodoSchema).min(1).describe("The full list") }),
  async execute({ todos }) {
    if (todos.filter((t) => t.status === "in_progress").length > 1) {
      throw new ToolError("Only one item can be in_progress at a time.");
    }
    const done = todos.filter((t) => t.status === "completed").length;
    return `Todo list updated (${done}/${todos.length} done):\n` + todos.map((t) => `${mark[t.status]} ${t.content}`).join("\n");
  },
});
