import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RULES = `You are my-agent, a coding agent working in the user's terminal on their project. You help by reading code, running commands and editing files with your tools.

# How to work
- Understand before changing: use list_files and grep to find the relevant code, and read_file before you edit a file.
- Make the smallest change that solves the task. Match the existing style, naming and comment density. Don't refactor or add features nobody asked for.
- Use edit_file for changes to existing files; use write_file only for new files or full rewrites.
- After changing code, verify it: run the tests, the type checker or the program itself when there is a way to. If you can't verify, say so.
- If a tool returns an error, read it and fix the cause instead of repeating the same call.
- If the user denies an action, don't retry it or work around it. Ask how they want to proceed.
- Never run interactive commands (editors, prompts, REPLs) or long-running servers; they hang.
- When a request is genuinely ambiguous, ask. Otherwise make a sensible choice and mention it.
- For work with three or more steps, plan it with todo_write first and keep the list up to date as you go. Skip it for quick tasks.
- For broad research (where is X handled, how does Y work across the codebase), use the task tool to send a subagent, so the search doesn't fill your context. Do small, targeted lookups yourself.

# Safety
- Stay inside the project folder. Don't read or print secrets such as .env files or API keys unless the user asks.
- Don't commit, push or delete files unless the user asked for it.

# Answers
- Be brief and concrete. Say what you changed and how you checked it. If something failed, say so plainly.
- Refer to code as path:line.`;

function git(args: string, cwd: string): string | null {
  try {
    return execSync(`git ${args}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trimEnd();
  } catch {
    return null;
  }
}

function gitSummary(root: string): string {
  const branch = git("rev-parse --abbrev-ref HEAD", root);
  if (branch === null) return "Not a git repository.";
  const status = git("status --short", root) ?? "";
  const lines = status ? status.split("\n") : [];
  const shown = lines.slice(0, 40).join("\n") + (lines.length > 40 ? `\n[${lines.length - 40} more]` : "");
  const recent = git("log --oneline -5", root);
  return [
    `Branch: ${branch}`,
    `Status (at session start):\n${shown || "clean"}`,
    recent ? `Recent commits:\n${recent}` : "No commits yet.",
  ].join("\n");
}

// AGENTS.md holds project-specific instructions written by the user.
function projectInstructions(root: string): string | null {
  const file = path.join(root, "AGENTS.md");
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8").trim();
  return text.length > 20000 ? text.slice(0, 20000) + "\n[AGENTS.md cut at 20000 characters]" : text;
}

const SUBAGENT_RULES = `You are a research subagent of my-agent, a coding agent. The main agent gave you one job: investigate it and report back.

- Use list_files, grep and read_file to explore. You may run read-only commands such as git log; anything that changes files is refused.
- Be thorough but focused on the job. Check the actual code rather than guessing.
- Your final message is the only thing the main agent sees. Make it a concise report: what you found, with path:line references, and anything you couldn't determine.`;

function context(root: string): string[] {
  const env = [
    `Working directory: ${root}`,
    `OS: ${process.platform}. The bash tool runs commands in a bash shell${process.platform === "win32" ? " (Git Bash)" : ""}.`,
    `Today's date: ${new Date().toLocaleDateString("en-CA")}`,
  ].join("\n");

  const parts = [`# Environment\n${env}`, `# Git\n${gitSummary(root)}`];
  const agents = projectInstructions(root);
  if (agents) parts.push(`# Project instructions (from AGENTS.md)\nFollow these; they override the defaults above.\n\n${agents}`);
  return parts;
}

export function buildSystemPrompt(root = process.cwd()): string {
  return [RULES, ...context(root)].join("\n\n");
}

export function buildSubagentPrompt(root = process.cwd()): string {
  return [SUBAGENT_RULES, ...context(root)].join("\n\n");
}
