#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(repoDir, "skills/jev-cu-jp/SKILL.md"), "utf8");
const locations = {
  codex: ".codex/skills",
  claude: ".claude/skills",
  pi: ".pi/agent/skills",
};
const previousTemplateHashes = new Set([
  "a79f9d358755a321e37c61b32d78b46a43f6c9aa58b1d40882b1c07f8045df77", // v0.2.2
]);

function isUnmodifiedPreviousSkill(content, command) {
  const renderedCommand = `\`${command}\``;
  if (!content.includes(renderedCommand)) return false;
  const template = content.replace(renderedCommand, "`{{NEXT_COMMAND}}`");
  return previousTemplateHashes.has(createHash("sha256").update(template).digest("hex"));
}

export function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function installSkill(target, {
  command = `node ${shellQuote(path.join(repoDir, "scripts/jev-next.mjs"))}`,
  homeDir = os.homedir(),
  dryRun = false,
  allowExisting = false,
  refreshManaged = false,
} = {}) {
  if (!Object.hasOwn(locations, target)) throw new Error("invalid_target");
  const destination = path.join(homeDir, locations[target], "jev-cu-jp");
  const content = source.replaceAll("{{NEXT_COMMAND}}", command);
  if (content === source) throw new Error("skill_template_invalid");
  let exists = false;
  try { fs.lstatSync(destination); exists = true; }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (exists) {
    try {
      const skillFile = path.join(destination, "SKILL.md");
      if (!fs.lstatSync(destination).isDirectory() || !fs.lstatSync(skillFile).isFile()) {
        throw new Error("skill_already_exists");
      }
      const installed = fs.readFileSync(skillFile, "utf8");
      if (allowExisting && installed === content) return destination;
      if (refreshManaged && isUnmodifiedPreviousSkill(installed, command)) {
        if (!dryRun) fs.writeFileSync(skillFile, content);
        return destination;
      }
    } catch (error) {
      if (error?.message !== "skill_already_exists" && error?.code !== "ENOENT") throw error;
    }
    throw new Error("skill_already_exists");
  }
  if (!dryRun) {
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, "SKILL.md"), content, { flag: "wx", mode: 0o644 });
  }
  return destination;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const dryRun = args[1] === "--dry-run";
  if (args.length > (dryRun ? 2 : 1)) {
    process.stderr.write("Usage: node scripts/install-skill.mjs codex|claude|pi [--dry-run]\n");
    process.exit(2);
  }
  try {
    const destination = installSkill(args[0], { dryRun });
    process.stdout.write(`${dryRun ? "Would install" : "Installed"}: ${destination}\n`);
  } catch (error) {
    process.stderr.write(`${error?.message ?? "setup_failed"}\n`);
    process.exitCode = 1;
  }
}
