import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// The folder zarvis is installed in: one up from src/ when developing, or from dist/ when built.
export const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Everything zarvis stores lives here. ZARVIS_HOME overrides it (the tests use that).
export const HOME_DIR = process.env.ZARVIS_HOME ?? path.join(os.homedir(), ".zarvis");

export interface Config {
  baseURL: string;
  apiKey: string;
  model: string;
  contextTokens?: number;
}

// Settings come from the environment, then zarvis's own .env, then ~/.zarvis/.env.
// The .env of the project you're working in is deliberately not read: its keys belong to that project.
export function loadConfig(): Config {
  const files = [path.join(PACKAGE_DIR, ".env"), path.join(HOME_DIR, ".env")];
  dotenv.config({ path: files, quiet: true });

  const missing = ["API_KEY", "MODEL"].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(" and ")}. Add ${missing.length > 1 ? "them" : "it"} to ${files[1]} (or ${files[0]}), for example:\n\n` +
        `BASE_URL=https://openrouter.ai/api/v1\nAPI_KEY=sk-or-...\nMODEL=poolside/laguna-s-2.1:free`,
    );
  }
  return {
    baseURL: process.env.BASE_URL || "https://openrouter.ai/api/v1",
    apiKey: process.env.API_KEY!,
    model: process.env.MODEL!,
    contextTokens: Number(process.env.CONTEXT_TOKENS) || undefined,
  };
}
