import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const saved = { ...process.env };
afterEach(() => {
  for (const k of ["API_KEY", "MODEL", "BASE_URL", "ZARVIS_PROXY"]) delete process.env[k];
  Object.assign(process.env, saved);
});

describe("loadConfig", () => {
  it("uses the hosted server when there is no key of your own", () => {
    process.env.ZARVIS_HOME = "/nonexistent";
    process.env.API_KEY = ""; // empty, not deleted, so dotenv does not load a real key from a .env
    process.env.MODEL = "";
    process.env.ZARVIS_PROXY = "https://zarvis.example.dev/";
    expect(loadConfig()).toMatchObject({ baseURL: "https://zarvis.example.dev/v1", apiKey: "zarvis-public" });
  });

  it("prefers your own key when you have one", () => {
    process.env.ZARVIS_PROXY = "https://zarvis.example.dev";
    process.env.API_KEY = "sk-own";
    process.env.MODEL = "some/model";
    expect(loadConfig()).toMatchObject({ apiKey: "sk-own", model: "some/model" });
  });
});
