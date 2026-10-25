import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { HOME_DIR } from "./config.js";

const DEFAULT_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "poolside/laguna-s-2.1:free";

// Asks for the settings once and saves them to ~/.zarvis/.env, so a fresh install can just start.
export async function firstRunSetup(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("Welcome to Zarvis. Let's set it up (saved to " + path.join(HOME_DIR, ".env") + ").");
  console.log("Get a free key at https://openrouter.ai/keys\n");
  try {
    const apiKey = (await rl.question("API key: ")).trim();
    if (!apiKey) throw new Error("No API key entered.");
    const baseURL = (await rl.question(`API URL [${DEFAULT_URL}]: `)).trim() || DEFAULT_URL;
    const model = (await rl.question(`Model [${DEFAULT_MODEL}]: `)).trim() || DEFAULT_MODEL;
    fs.mkdirSync(HOME_DIR, { recursive: true });
    fs.writeFileSync(path.join(HOME_DIR, ".env"), `BASE_URL=${baseURL}\nAPI_KEY=${apiKey}\nMODEL=${model}\n`, { mode: 0o600 });
    console.log("\nSaved. Starting...\n");
  } finally {
    rl.close();
  }
}
