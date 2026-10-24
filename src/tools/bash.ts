import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { z } from "zod";
import { defineTool, ROOT, truncate } from "./types.js";

// Models are best at bash, so on Windows we use Git Bash (installed with Git).
const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const SHELL = process.platform === "win32" && existsSync(GIT_BASH) ? GIT_BASH : undefined;

export const bash = defineTool({
  name: "bash",
  description: "Run a shell command in the project folder. Never run interactive commands or long-running servers.",
  risk: "exec",
  schema: z.object({
    command: z.string().describe("The command to run"),
    timeout: z.number().int().max(600).default(120).describe("Timeout in seconds"),
  }),
  execute({ command, timeout }, { signal }) {
    return new Promise((resolve) => {
      const child = exec(
        command,
        { cwd: ROOT, shell: SHELL, timeout: timeout * 1000, maxBuffer: 10 * 1024 * 1024, signal },
        (err, stdout, stderr) => {
          const code = signal?.aborted ? "interrupted by user" : err ? (err.killed ? "timed out" : err.code ?? 1) : 0;
          let out = `exit code: ${code}\n${stdout}`;
          if (stderr) out += `\n[stderr]\n${stderr}`;
          resolve(truncate(out));
        },
      );
      child.stdin?.end(); // so commands waiting for input don't hang forever
    });
  },
});
