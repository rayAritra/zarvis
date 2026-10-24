import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Msg } from "./loop.js";
import { HOME_DIR } from "./config.js";

export interface SessionData {
  id: string;
  cwd: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messages: Msg[];
}

const samePath = (a: string, b: string) =>
  process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

export class Session {
  constructor(
    public data: SessionData,
    private dir = path.join(HOME_DIR, "sessions"),
  ) {}

  static create(cwd: string, model: string, dir?: string): Session {
    const now = new Date().toISOString();
    const id = `${now.slice(0, 19).replace(/[-:T]/g, "")}-${randomBytes(2).toString("hex")}`;
    return new Session({ id, cwd, model, createdAt: now, updatedAt: now, messages: [] }, dir);
  }

  static load(id: string, dir = path.join(HOME_DIR, "sessions")): Session {
    const file = path.join(dir, `${id}.json`);
    if (!fs.existsSync(file)) throw new Error(`No session called ${id}.`);
    return new Session(JSON.parse(fs.readFileSync(file, "utf8")), dir);
  }

  // The most recently updated session started in this folder.
  static latest(cwd: string, dir = path.join(HOME_DIR, "sessions")): Session | null {
    if (!fs.existsSync(dir)) return null;
    let best: SessionData | null = null;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const data: SessionData = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
        if (samePath(data.cwd, cwd) && (!best || data.updatedAt > best.updatedAt)) best = data;
      } catch {
        // A half-written or hand-edited file shouldn't stop the others from loading.
      }
    }
    return best && new Session(best, dir);
  }

  // Writes to a temp file first, so a crash mid-save can't corrupt the session.
  save(messages: Msg[]) {
    if (messages.length <= 1) return; // nothing but the system prompt
    this.data.messages = messages;
    this.data.updatedAt = new Date().toISOString();
    fs.mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, `${this.data.id}.json`);
    fs.writeFileSync(file + ".tmp", JSON.stringify(this.data));
    fs.renameSync(file + ".tmp", file);
  }
}
