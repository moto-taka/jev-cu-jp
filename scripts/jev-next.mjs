#!/usr/bin/env node
import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decide } from "./jev-decide.mjs";
import { evaluatePolicy } from "./policy.mjs";

function validText(value, max, optional = false) {
  return typeof value === "string" && value.length <= max && (optional || value.trim().length > 0);
}

export function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_input");
  if (!validText(input.goal, 500) || !validText(input.app, 120)) throw new Error("invalid_input");
  if (!Array.isArray(input.candidates) || input.candidates.length < 2 || input.candidates.length > 80) {
    throw new Error("invalid_candidates");
  }
  const indices = new Set();
  for (const candidate of input.candidates) {
    if (!candidate || !Number.isSafeInteger(candidate.index) || candidate.index < 0 ||
        !validText(candidate.role, 80) || !validText(candidate.label, 240, true)) {
      throw new Error("invalid_candidates");
    }
    if (indices.has(candidate.index)) throw new Error("duplicate_candidate_index");
    indices.add(candidate.index);
  }
  if (input.context !== undefined && !validText(input.context, 1500, true)) throw new Error("invalid_input");
  if (input.constraints !== undefined && !validText(input.constraints, 1000, true)) throw new Error("invalid_input");
  if (input.recentActions !== undefined &&
      (!Array.isArray(input.recentActions) || input.recentActions.length > 6 ||
       !input.recentActions.every((action) => validText(action, 120, true)))) {
    throw new Error("invalid_input");
  }
  return {
    goal: input.goal,
    app: input.app,
    candidates: input.candidates.map(({ index, role, label }) => ({ index, role, label })),
    context: input.context ?? "",
    constraints: input.constraints ?? "",
    recentActions: input.recentActions ?? [],
  };
}

export async function evaluateNext(input, { decideFn = decide } = {}) {
  const parsed = validateInput(input);
  const result = await decideFn(parsed);
  const selected = parsed.candidates.find(({ index }) => index === result.targetIndex);
  const decision = {
    targetIndex: selected?.index ?? null,
    targetLabel: selected?.label ?? null,
    action: result.action ?? null,
    confidence: result.confidence ?? null,
    choiceProbability: selected ? result.probabilities?.[`i${selected.index}`] ?? null : null,
    done: result.done ?? null,
    risk: result.risk ?? null,
  };
  let policy = evaluatePolicy({ decision, app: parsed.app });
  if (policy.verdict === "proceed" && !["click_element", "wait"].includes(decision.action)) {
    policy = {
      verdict: "escalate",
      kind: "action_parameters",
      reasons: ["操作に必要な座標・文字・キーなどはJevの回答に含まれません"],
    };
  }
  return {
    decision,
    policy: { verdict: policy.verdict, kind: policy.kind ?? null, reasons: policy.reasons },
    usage: {
      provider: result.provider ?? null,
      model: result.model ?? null,
      inputTokens: result.usage?.input_tokens ?? result.usage?.inputTokens ?? null,
      latencyMs: result.latencyMs ?? null,
      costUsd: result.costUsd ?? null,
    },
  };
}

async function readInput(args) {
  if (args.length > 1) throw new Error("invalid_arguments");
  if (args[0]) return fs.readFile(args[0], "utf8");
  let content = "";
  for await (const chunk of process.stdin) content += chunk;
  return content;
}

export async function runNextCli(args = process.argv.slice(2)) {
  try {
    const result = await evaluateNext(JSON.parse(await readInput(args)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const codes = new Set(["invalid_input", "invalid_candidates", "duplicate_candidate_index", "invalid_arguments"]);
    const code = codes.has(error?.message) ? error.message : "jev_request_failed";
    const status = Number.isInteger(error?.status) ? error.status : null;
    process.stderr.write(`${JSON.stringify({ error: code, status })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  void runNextCli();
}
