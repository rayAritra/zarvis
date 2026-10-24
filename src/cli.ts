import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runTurn } from "./loop.js";

const rl = readline.createInterface({ input, output });
const confirm = async (q: string) => (await rl.question(q)).trim().toLowerCase().startsWith("y");
console.log("my-agent ready. Type 'exit' to quit.");

while (true) {
  const text = (await rl.question("> ")).trim();
  if (!text) continue;
  if (text === "exit") break;

  try {
    await runTurn(text, confirm);
  } catch (err) {
    console.error("Error:", (err as Error).message);
  }
}

rl.close();