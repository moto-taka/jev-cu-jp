#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { configuredKey, configuredProvider, CONFIG_FILE, saveProviderKey } from "./config.mjs";
import { installSkill, shellQuote } from "./install-skill.mjs";
import { decide } from "./jev-decide.mjs";
import { runNextCli } from "./jev-next.mjs";

const packageInfo = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const keyNames = { typesafe: "TYPESAFE_API_KEY", vercel: "AI_GATEWAY_API_KEY" };

function usage() {
  process.stdout.write([
    `jev-cu-jp ${packageInfo.version}`,
    "Usage:",
    "  jev-cu-jp setup codex|claude|pi [--provider typesafe|vercel] [--clipboard|--key-stdin]",
    "  jev-cu-jp next [input.json]",
    "  jev-cu-jp doctor",
    "  jev-cu-jp --version",
  ].join("\n") + "\n");
}

function parseSetup(args) {
  const host = args.shift();
  const parsed = { host, provider: configuredProvider() ?? "typesafe", keySource: null };
  while (args.length) {
    const option = args.shift();
    if (option === "--provider" && args.length) parsed.provider = args.shift();
    else if (option === "--clipboard" && !parsed.keySource) parsed.keySource = "clipboard";
    else if (option === "--key-stdin" && !parsed.keySource) parsed.keySource = "stdin";
    else throw new Error("invalid_arguments");
  }
  if (!Object.hasOwn(keyNames, parsed.provider)) throw new Error("invalid_provider");
  return parsed;
}

async function readKey(source) {
  if (source === "clipboard") {
    if (process.platform !== "darwin") throw new Error("clipboard_requires_macos");
    const result = spawnSync("pbpaste", [], { encoding: "utf8" });
    if (result.status !== 0) throw new Error("clipboard_unavailable");
    return result.stdout.trim();
  }
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value.trim();
}

export async function verifyApiKey(provider, key, { decideFn = decide } = {}) {
  try {
    await decideFn({
      goal: "次の月へ進む",
      app: "Setup",
      candidates: [
        { index: 1, role: "button", label: "前の月" },
        { index: 2, role: "button", label: "次の月" },
      ],
      provider,
      apiKey: key,
      maxRetries: 0,
      timeoutMs: 15_000,
    });
  } catch (error) {
    throw new Error([401, 403].includes(error?.status) ? "invalid_api_key" : "connection_failed");
  }
}

async function setup(args) {
  const { host, provider, keySource } = parseSetup([...args]);
  const executable = process.env.JEV_CU_JP_COMMAND
    ? shellQuote(process.env.JEV_CU_JP_COMMAND)
    : `node ${shellQuote(fileURLToPath(import.meta.url))}`;
  const command = `${executable} next`;
  installSkill(host, { command, dryRun: true, allowExisting: true });
  const key = keySource ? await readKey(keySource) : null;
  if (keySource && (!key || key.length > 8192)) throw new Error("empty_api_key");
  if (key) {
    await verifyApiKey(provider, key);
    saveProviderKey(provider, key);
  }
  const destination = installSkill(host, { command, allowExisting: true });
  process.stdout.write(`Skill installed: ${destination}\n`);
  if (key) process.stdout.write(`Key saved locally for ${provider}: ${CONFIG_FILE}\n`);
  else process.stdout.write(`Set ${keyNames[provider]} or run setup with --clipboard / --key-stdin.\n`);
  process.stdout.write("Restart the agent to load the skill.\n");
}

function doctor() {
  const provider = process.env.JEV_PROVIDER || configuredProvider() || "typesafe";
  const envName = keyNames[provider];
  if (!envName) throw new Error("invalid_provider");
  const configured = Boolean(process.env[envName]);
  const saved = Boolean(configuredKey(provider));
  process.stdout.write(JSON.stringify({
    version: packageInfo.version,
    provider,
    keyAvailable: configured || saved,
    configFile: CONFIG_FILE,
  }) + "\n");
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "help") return usage();
  if (command === "--version" || command === "version") {
    process.stdout.write(`${packageInfo.version}\n`);
    return;
  }
  if (command === "next") return runNextCli(args);
  try {
    if (command === "setup") return await setup(args);
    if (command === "doctor" && !args.length) return doctor();
    throw new Error("invalid_arguments");
  } catch (error) {
    const codes = new Set([
      "invalid_arguments", "invalid_target", "invalid_provider", "skill_already_exists",
      "clipboard_requires_macos", "clipboard_unavailable", "empty_api_key",
      "invalid_api_key", "connection_failed",
    ]);
    process.stderr.write(`${codes.has(error?.message) ? error.message : "setup_failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  void main();
}
