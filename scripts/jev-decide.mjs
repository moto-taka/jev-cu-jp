#!/usr/bin/env node
/**
 * Jev 決定ラッパー（TypeSafe 直接接続 / Vercel AI Gateway）。
 *
 * - 读取 key：环境变量 TYPESAFE_API_KEY，或项目根目录 .env.local
 * - ask()   ：发一次 systemone 请求（可并发多问）
 * - decide()：Computer Use 循环用的标准四问（target/action/done/risk）
 *
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configuredKey, configuredProvider } from "./config.mjs";

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_MODEL = "jev-latest";
export const GATEWAY_ENDPOINT = "https://ai-gateway.vercel.sh/typesafe/v1/systemone";
export const GATEWAY_MODEL = "typesafe-ai/jev";
const PROVIDERS = {
  typesafe: { endpoint: DEFAULT_ENDPOINT, model: DEFAULT_MODEL, envVar: "TYPESAFE_API_KEY" },
  vercel: { endpoint: GATEWAY_ENDPOINT, model: GATEWAY_MODEL, envVar: "AI_GATEWAY_API_KEY" },
};
/** 官方价：$42/Btok = $0.042/Mtok 输入；输出免费 */
export const PRICE_PER_INPUT_TOKEN_USD = 0.042 / 1e6;

export function loadApiKey({
  envVar = "TYPESAFE_API_KEY",
  envFile = path.join(PROJECT_DIR, ".env.local"),
} = {}) {
  const env = globalThis.process?.env ?? {};
  if (env[envVar]) return String(env[envVar]).trim();
  try {
    const text = fs.readFileSync(envFile, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && m[1] === envVar) {
        const value = m[2].replace(/^['"]|['"]$/g, "").trim();
        if (value) return value;
      }
    }
  } catch {
    /* 文件不存在时走统一报错 */
  }
  const provider = Object.entries(PROVIDERS).find(([, value]) => value.envVar === envVar)?.[0];
  const saved = provider ? configuredKey(provider) : null;
  if (typeof saved === "string" && saved.trim()) return saved.trim();
  throw new Error(`${envVar} が見つかりません。環境変数、.env.local、または setup コマンドで設定してください`);
}

export function estimateCostUsd(usage = {}) {
  const tokens = usage.input_tokens ?? usage.inputTokens ?? 0;
  return tokens * PRICE_PER_INPUT_TOKEN_USD;
}

function toNumber(value) {
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 候选描述清洗：去掉 URL 等噪声，控制 token 体积（导出以便单测） */
export function sanitizeLabel(text, max = 120) {
  return String(text ?? "")
    .replace(/\b(?:https?|orpheus|file|javascript|data):\S*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** 构造循环用的四个标准问题（导出以便单测） */
export function buildQuestions(goal, candidates = []) {
  const criteria = {};
  for (const c of candidates) criteria[`i${c.index}`] = sanitizeLabel(`${c.role}: ${c.label}`);

  return {
    criteria,
    questions: {
      target: {
        type: "choice",
        instructions: `Which single element should be acted on next to accomplish the goal? Goal: ${goal}`,
        criteria,
      },
      action: {
        type: "choice",
        instructions: "What is the next action type?",
        criteria: {
          click_element: "Click the chosen element",
          click_at: "Click a canvas position (coordinates come from the planner)",
          drag: "Drag on the canvas (coordinates come from the planner)",
          set_value: "Replace the value of a text input",
          type_text: "Type the provided text",
          press_key: "Press a keyboard key",
          scroll: "Scroll the current view",
          wait: "Wait for the UI to update",
          ask_user: "Stop and ask the user",
        },
      },
      done: {
        type: "noul",
        instructions: "Is the goal already visibly achieved in the current UI state?",
      },
      risk: {
        type: "noul",
        instructions:
          "Does the next action require explicit user confirmation (delete data, send/submit, pay/subscribe, change permissions, upload/share, solve CAPTCHA, install software, change system settings, enter credentials)?",
        criteria: {
          true: "delete / send / pay / permission / upload / captcha / install / system settings / credentials",
          false: "safe reversible navigation such as opening, searching, scrolling, selecting, reading",
        },
      },
    },
  };
}

/** 把 API answers 归一化成循环可用的结构（导出以便单测） */
export function normalizeDecision(answers = {}, criteria = {}) {
  const targetKey = answers.target?.choice ?? null;
  const valid = typeof targetKey === "string" && /^i\d+$/.test(targetKey) && Object.hasOwn(criteria, targetKey);
  return {
    action: answers.action?.choice ?? null,
    targetKey: valid ? targetKey : null,
    targetIndex: valid ? Number(targetKey.slice(1)) : null,
    targetLabel: valid ? (criteria[targetKey] ?? null) : null,
    done: toNumber(answers.done?.noul ?? answers.done?.probability),
    risk: toNumber(answers.risk?.noul ?? answers.risk?.probability),
    confidence: toNumber(answers.target?.confidence),
    probabilities: answers.target?.probabilities ?? {},
  };
}

function buildDecisionRequest({ goal, app, candidates, context, recentActions, constraints }) {
  const { criteria, questions } = buildQuestions(goal, candidates);
  return {
    criteria,
    questions,
    state: {
      goal,
      app,
      context: String(context).slice(0, 1_500),
      candidates: Object.entries(criteria).map(([id, desc]) => ({ id, desc })),
      recent_actions: recentActions.slice(-6),
      constraints,
    },
  };
}

export async function ask({
  state,
  questions,
  provider = globalThis.process?.env?.JEV_PROVIDER || configuredProvider() || "typesafe",
  model,
  apiKey,
  endpoint,
  maxRetries = 2,
  timeoutMs = 60_000,
  fetchImpl = fetch,
}) {
  const config = PROVIDERS[provider];
  if (!config) throw new Error(`JEV_PROVIDER は typesafe または vercel を指定してください: ${provider}`);
  const resolvedModel = model ?? config.model;
  const resolvedEndpoint = endpoint ?? config.endpoint;
  const key = apiKey ?? loadApiKey({ envVar: config.envVar });
  if (!key) throw new Error(`${config.envVar} が空です`);
  const backoff = [1_000, 3_000, 8_000];

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    let res;
    try {
      res = await fetchImpl(resolvedEndpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ state, model: resolvedModel, questions }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = Date.now() - startedAt;
    const body = await res.json().catch(() => null);

    if (res.ok && body?.answers) {
      const gatewayCost = toNumber(body.provider_metadata?.gateway?.cost ?? body.providerMetadata?.gateway?.cost);
      return {
        answers: body.answers,
        usage: body.usage ?? {},
        model: body.model ?? resolvedModel,
        provider,
        latencyMs,
        costUsd: provider === "vercel" ? gatewayCost : estimateCostUsd(body.usage),
        raw: body,
      };
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= maxRetries) {
      const message = body?.detail?.message ?? body?.error?.message ?? body?.message ?? JSON.stringify(body)?.slice(0, 200) ?? res.statusText;
      const err = new Error(`Jev 呼び出し失敗 HTTP ${res.status}（${latencyMs}ms）：${message}`);
      err.status = res.status;
      throw err;
    }
    await sleep(backoff[Math.min(attempt, backoff.length - 1)]);
  }
}

/**
 * Computer Use 循环的标准决策入口。
 * @param {object} input
 * @param {string} input.goal 目標。日本語も指定できる。
 * @param {string} input.app
 * @param {Array<{index:number, role:string, label:string}>} input.candidates
 * @param {string} [input.context] 少量界面上下文（窗口标题/焦点行）
 * @param {string[]} [input.recentActions]
 * @param {string} [input.constraints]
 */
export async function decide({
  goal,
  app,
  candidates = [],
  context = "",
  recentActions = [],
  constraints = "",
  ...askOptions
}) {
  const { criteria, questions, state } = buildDecisionRequest({ goal, app, candidates, context, recentActions, constraints });
  const r = await ask({ state, questions, ...askOptions });
  return {
    ...normalizeDecision(r.answers, criteria),
    usage: r.usage,
    latencyMs: r.latencyMs,
    costUsd: r.costUsd,
    model: r.model,
    provider: r.provider,
    raw: r.raw,
  };
}
