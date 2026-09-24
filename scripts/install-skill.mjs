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
const sharedLocation = ".agents/skills/jev-cu-jp";
const previousTemplateHashes = new Set([
  "a79f9d358755a321e37c61b32d78b46a43f6c9aa58b1d40882b1c07f8045df77", // v0.2.2
]);

function isUnmodifiedPreviousSkill(content, command) {
  const renderedCommand = `\`${command}\``;
  if (!content.includes(renderedCommand)) return false;
  const template = content.replace(renderedCommand, "`{{NEXT_COMMAND}}`");
  return previousTemplateHashes.has(createHash("sha256").update(template).digest("hex"));
}

function lstatIfExists(file) {
  try { return fs.lstatSync(file); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function readSkillDirectory(directory) {
  if (!lstatIfExists(directory)?.isDirectory()) throw new Error("skill_already_exists");
  const skillFile = path.join(directory, "SKILL.md");
  if (!lstatIfExists(skillFile)?.isFile()) throw new Error("skill_already_exists");
  return fs.readFileSync(skillFile, "utf8");
}

function isManagedContent(installed, expected, command, refreshManaged) {
  return installed === expected || (refreshManaged && isUnmodifiedPreviousSkill(installed, command));
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
  const shared = path.join(homeDir, sharedLocation);
  const content = source.replaceAll("{{NEXT_COMMAND}}", command);
  if (content === source) throw new Error("skill_template_invalid");
  const sharedStat = lstatIfExists(shared);
  const destinationStat = lstatIfExists(destination);
  const sharedContent = sharedStat ? readSkillDirectory(shared) : null;
  if (sharedContent !== null && !isManagedContent(sharedContent, content, command, refreshManaged)) {
    throw new Error("skill_already_exists");
  }
  if (destinationStat) {
    if (!allowExisting) throw new Error("skill_already_exists");
    if (destinationStat.isSymbolicLink()) {
      const link = fs.readlinkSync(destination);
      const linkedPath = path.resolve(path.dirname(destination), link);
      if (linkedPath !== shared &&
          (!sharedStat || fs.realpathSync(destination) !== fs.realpathSync(shared))) {
        throw new Error("skill_already_exists");
      }
    } else if (destinationStat.isDirectory()) {
      if (fs.readdirSync(destination).join("\n") !== "SKILL.md" ||
          !isManagedContent(readSkillDirectory(destination), content, command, refreshManaged)) {
        throw new Error("skill_already_exists");
      }
    } else throw new Error("skill_already_exists");
  }
  if (dryRun) return destination;
  fs.mkdirSync(path.dirname(shared), { recursive: true });
  if (!sharedStat) {
    if (destinationStat?.isDirectory()) fs.renameSync(destination, shared);
    else {
      fs.mkdirSync(shared);
      fs.writeFileSync(path.join(shared, "SKILL.md"), content, { flag: "wx", mode: 0o644 });
    }
  } else if (destinationStat?.isDirectory()) {
    fs.unlinkSync(path.join(destination, "SKILL.md"));
    fs.rmdirSync(destination);
  }
  if (sharedContent !== content) fs.writeFileSync(path.join(shared, "SKILL.md"), content);
  if (!destinationStat?.isSymbolicLink()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const linkTarget = process.platform === "win32" ? shared : path.relative(path.dirname(destination), shared);
    fs.symlinkSync(linkTarget, destination, process.platform === "win32" ? "junction" : "dir");
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
