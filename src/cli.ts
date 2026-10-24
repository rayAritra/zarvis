import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runTurn, type Confirm } from "./loop.js";

const rl = readline.createInterface({ input, output });
const confirm: Confirm = async (q, canAlways) => {
  const a = (await rl.question(q)).trim().toLowerCase();
  if (a.startsWith("a") && canAlways) return "always";
  return a.startsWith("y") ? "yes" : "no";
};
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