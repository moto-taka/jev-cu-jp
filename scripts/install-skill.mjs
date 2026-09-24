#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(repoDir, "skills/jev-cu-jp/SKILL.md"), "utf8");
const destinations = {
  codex: path.join(os.homedir(), ".codex/skills/jev-cu-jp"),
  claude: path.join(os.homedir(), ".claude/skills/jev-cu-jp"),
  pi: path.join(os.homedir(), ".pi/agent/skills/jev-cu-jp"),
};

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const args = process.argv.slice(2);
const target = args[0];
const dryRun = args[1] === "--dry-run";
if (!Object.hasOwn(destinations, target) || args.length > (dryRun ? 2 : 1)) {
  process.stderr.write("Usage: node scripts/install-skill.mjs codex|claude|pi [--dry-run]\n");
  process.exit(2);
}

const destination = destinations[target];
if (fs.existsSync(destination)) {
  process.stderr.write(`Skill already exists: ${destination}\n`);
  process.exit(1);
}
const content = source.replaceAll("{{NEXT_COMMAND}}", `node ${shellQuote(path.join(repoDir, "scripts/jev-next.mjs"))}`);
if (content === source) {
  process.stderr.write("Skill template marker missing\n");
  process.exit(1);
}
if (!dryRun) {
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, "SKILL.md"), content, { flag: "wx", mode: 0o644 });
}
process.stdout.write(`${dryRun ? "Would install" : "Installed"}: ${destination}\n`);
