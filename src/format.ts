// Short, human-readable descriptions of tool activity, shared by the UI and headless mode.

// The one argument that best describes a tool call, e.g. the command for bash.
export function describeArgs(name: string, args: any): string {
  if (name === "todo_write") return `${args.todos?.length ?? 0} items`;
  const main = args.command ?? args.path ?? args.pattern ?? args.description;
  const text = typeof main === "string" ? main : JSON.stringify(args);
  const extra = name === "grep" && args.glob && args.glob !== "**/*" ? `  in ${args.glob}` : "";
  return (text + extra).replace(/\s+/g, " ").slice(0, 160);
}

export function describeResult(name: string, text: string): string {
  if (text.startsWith("Error:")) return text.split("\n")[0];
  const lines = text.split("\n").filter(Boolean);
  if (name === "bash") return `${lines[0]}${lines.length > 1 ? `, ${lines.length - 1} lines of output` : ""}`;
  if (name === "read_file") return `${lines.length} lines`;
  if (name === "list_files" || name === "grep") return lines.length === 1 ? lines[0] : `${lines.length} results`;
  if (name === "task") return `report: ${lines.length} lines`;
  return lines[0]?.slice(0, 160) ?? "";
}
