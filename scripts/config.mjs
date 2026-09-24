import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CONFIG_FILE = path.join(os.homedir(), ".config", "jev-cu-jp", "config.json");
const KEY_NAMES = { typesafe: "TYPESAFE_API_KEY", vercel: "AI_GATEWAY_API_KEY" };

export function readConfig(file = CONFIG_FILE) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error("Jev CU JP の設定ファイルを読み取れません");
  }
}

export function configuredProvider(file = CONFIG_FILE) {
  const provider = readConfig(file).provider;
  return Object.hasOwn(KEY_NAMES, provider) ? provider : null;
}

export function configuredKey(provider, file = CONFIG_FILE) {
  const name = KEY_NAMES[provider];
  return name ? readConfig(file)[name] ?? null : null;
}

export function saveProviderKey(provider, key, file = CONFIG_FILE) {
  if (!Object.hasOwn(KEY_NAMES, provider) || typeof key !== "string" || !key.trim()) {
    throw new Error("invalid_configuration");
  }
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const next = { ...readConfig(file), provider, [KEY_NAMES[provider]]: key.trim() };
  const temporary = path.join(directory, `.config-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(next) + "\n", { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* Already moved or absent. */ }
  }
}
