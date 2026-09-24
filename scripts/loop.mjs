/**
 * jev-use 循环引擎：观测（Computer Use）→ 决策（Jev）→ 门槛（Policy）→ 执行（Computer Use）。
 *
 * 设计约束：必须在 Codex 桌面 App 的 cua_repl JS 运行时里执行（那里有全局 `cua`）。
 * 本模块本身不 import 任何 cua 专有 API，通过 driver 适配器注入，便于单测。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decide as jevDecide } from "./jev-decide.mjs";
import { evaluatePolicy, DEFAULT_ALLOWED_APPS } from "./policy.mjs";

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* --------------------------- AX 解析与候选 --------------------------- */

const ROLES = [
  "standard window",
  "split group",
  "scroll area",
  "HTML content",
  "content list",
  "menu bar",
  "menu bar main-menu-bar",
  "toolbar",
  "radio button",
  "close button",
  "minimize button",
  "full screen button",
  "search field",
  "text field",
  "pop up button",
  "toggle button",
  "stepper",
  "combo box",
  "menu item",
  "button",
  "checkbox",
  "heading",
  "image",
  "link",
  "text",
  "grid",
  "list",
  "date time area",
  "row",
  "tab",
  "container",
  "Event",
];

// Localized role descriptions observed in CUA's Chinese Calculator output.
// Normalize roles only; labels, IDs and original lines remain unchanged.
const ROLE_ALIASES = new Map([
  ["标准窗口", "standard window"],
  ["分离组", "split group"],
  ["滚动区", "scroll area"],
  ["文本", "text"],
  ["按钮", "button"],
  ["標準ウインドウ", "standard window"],
  ["標準ウィンドウ", "standard window"],
  ["分割グループ", "split group"],
  ["スクロール領域", "scroll area"],
  ["メニューバー", "menu bar"],
  ["ツールバー", "toolbar"],
  ["ラジオボタン", "radio button"],
  ["閉じるボタン", "close button"],
  ["検索フィールド", "search field"],
  ["検索欄", "search field"],
  ["テキストフィールド", "text field"],
  ["入力欄", "text field"],
  ["ポップアップボタン", "pop up button"],
  ["トグルボタン", "toggle button"],
  ["メニュー項目", "menu item"],
  ["ボタン", "button"],
  ["チェックボックス", "checkbox"],
  ["見出し", "heading"],
  ["画像", "image"],
  ["リンク", "link"],
  ["テキスト", "text"],
  ["グリッド", "grid"],
  ["リスト", "list"],
  ["行", "row"],
  ["タブ", "tab"],
  ["コンテナ", "container"],
]);
const ROLE_NAMES = [...ROLES, ...ROLE_ALIASES.keys()].sort((a, b) => b.length - a.length);

const CLICKABLE_ROLES = new Set([
  "button",
  "radio button",
  "close button",
  "minimize button",
  "full screen button",
  "link",
  "menu item",
  "text field",
  "search field",
  "checkbox",
  "pop up button",
  "toggle button",
  "stepper",
  "combo box",
  "tab",
  "list",            // Calendar 月视图日格（role=list，如 "list Saturday, September 19"）
  "date time area",  // Calendar 日期/时间选择器（ID: start-datepicker / start-timepicker 等）
]);

/** 把 AX 文本解析成元素列表：{index, role, label, depth, raw} */
export function parseAX(axText) {
  const out = [];
  for (const line of String(axText ?? "").split(/\r?\n/)) {
    const m = line.match(/^(\s*)(\d+)\s+(.*)$/);
    if (!m) continue;
    const depth = m[1].replace(/\t/g, "    ").length;
    const rest = m[3].trim();
    const sourceRole = ROLE_NAMES.find((r) => rest === r || rest.startsWith(r + " ")) ?? rest.split(" ")[0];
    const role = ROLE_ALIASES.get(sourceRole) ?? sourceRole;
    // 清掉 AX 元数据尾巴（如 "Secondary Actions: Move next, Remove from toolbar"），
    // 它描述的是元素的次级动作列表，不是元素名称；保留会污染标签并误触敏感词门。
    const label = rest
      .slice(sourceRole.length)
      .trim()
      .replace(/,?\s*Secondary Actions:.*$/i, "")
      .trim();
    out.push({ index: Number(m[2]), role, label, depth, raw: line });
  }
  return out;
}

/**
 * 候选筛选：角色过滤 + 轻量打分。
 * 关键教训（P0 实测）：绝不能按位置盲截断，否则目标会被列表项挤出候选集。
 */
export function selectCandidates(elements, goal = "", { max = 40 } = {}) {
  const normalizedGoal = String(goal).normalize("NFKC").toLowerCase();
  const tokens = new Set((normalizedGoal.match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length >= 2));
  for (const run of normalizedGoal.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu) ?? []) {
    for (let i = 0; i < run.length - 1; i++) tokens.add(run.slice(i, i + 2));
  }

  const scored = [];
  for (const el of elements) {
    if (!CLICKABLE_ROLES.has(el.role)) continue;
    let score = 0;
    if (["button", "toggle button", "radio button", "menu item", "pop up button", "combo box"].includes(el.role)) score += 3;
    if (["text field", "search field"].includes(el.role)) score += 2;
    if (el.role === "link") score += 1;
    const label = `${el.label}`.normalize("NFKC").toLowerCase();
    if (label) {
      for (const t of tokens) if (label.includes(t)) score += 4;
    } else {
      score -= 2;
    }
    if (/^javascript:;?$/.test(el.label.trim()) || !el.label.trim()) score -= 2;
    if (/previous month|next month|today|搜索|search|前の月|次の月|今日|検索/i.test(el.label) && /month|搜索|search|月|検索/i.test(goal)) score += 6;
    if (el.role === "toggle button" && /toolbar|tool\b|tool\s/i.test(goal)) score += 5;
    scored.push({ ...el, score });
  }

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const clipped = scored.length > max;
  const selected = scored.slice(0, max);
  return Object.assign(selected, { clipped, totalClickable: scored.length });
}

/**
 * 给 Jev 的少量上下文：窗口标题 + 关键文本行（如计算器显示值）+ 焦点行。
 * 这些"状态反馈"是 Jev 能连续做对多步操作的关键，避免只给候选、看不到当前值。
 */
export function buildContext(axText, { maxTextLines = 6 } = {}) {
  const lines = String(axText ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const head = lines.slice(0, 2);
  const texts = parseAX(axText).filter((element) => element.role === "text")
    .slice(0, maxTextLines).map((element) => element.raw.trim());
  const focus = lines.find((l) => /focused UI element|フォーカスされたUI要素|フォーカス中のUI要素|現在のフォーカス/i.test(l));
  return [...head, ...texts, focus].filter(Boolean).join("\n").slice(0, 1_500);
}

/* ------------------------------ cua 适配 ------------------------------ */

export function createCuaDriver(cua) {
  let app = null;
  return {
    async bind(appName) {
      app = await cua.getApp(appName);
      return app;
    },
    async observe({ full = true } = {}) {
      return withRetry(() => app.getAXState({ emit: false, disableDiffing: full }), { attempts: 3, delayMs: 300 });
    },
    async click(index, options) {
      return app.click(index, options);
    },
    async drag(from, to) {
      return app.drag(from, to);
    },
    async setValue(index, value) {
      return app.setValue(index, value);
    },
    async typeText(text) {
      return app.typeText(text);
    },
    async pressKey(key) {
      return app.pressKey(key);
    },
    async scroll(index, direction, pages) {
      return app.scroll(index, direction, pages);
    },
  };
}

/* ------------------------------- 主循环 ------------------------------- */

const defaultEmit = (line) =>
  globalThis.nodeRepl?.write ? globalThis.nodeRepl.write(line + "\n") : console.log(line);

export async function runTask({
  driver,
  appName,
  goal,
  dryRun = true,
  maxSteps = 30,
  candidateMax = 40, // 候補上限。大きなカレンダーでは調整する。
  allowedApps = DEFAULT_ALLOWED_APPS,
  thresholds,
  decide = jevDecide,
  emit = defaultEmit,
  traceDir = path.join(PROJECT_DIR, "runs"),
  traceId,
  resources = {}, // { text, key, direction } はCodex側で用意する。
  constraints = "",
  plan = "", // Codexが段階を決め、Jevが操作対象を選ぶ。
  jevOptions = {},
  verify, // 任意。AX全体から総目標を確認する関数。
}) {
  const runId = traceId ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${appName.replace(/[^\p{L}\p{N}]+/gu, "")}`;
  fs.mkdirSync(traceDir, { recursive: true });
  const tracePath = path.join(traceDir, `${runId}.jsonl`);
  const record = (entry) => fs.appendFileSync(tracePath, JSON.stringify({ ts: new Date().toISOString(), runId, ...entry }) + "\n");

  emit(`[jev-use] run=${runId} app=${appName} dryRun=${dryRun} goal=${goal}`);
  record({ event: "start", appName, goal, dryRun, maxSteps, plan });

  await driver.bind(appName);
  let observation = await driver.observe({ full: true });
  const recentActions = [];
  const startedAt = Date.now();

  for (let step = 1; step <= maxSteps; step++) {
    // Planner 可以直接注入确定性步骤（画布坐标点击/拖拽/输入），无需 Jev 判断；
    // 需要判断"点哪个工具栏/面板元素"的步骤才交给 Jev。
    const planned = typeof resources === "function" ? ((await resources(step, null)) ?? {}) : {};
    if (planned.skipJev) {
      // 旧的 Planner 通道没有可验证的目标/风险，不再绕过策略直接执行。
      return finish(dryRun ? "dry_run" : "escalate", {
        steps: step - 1, tracePath, planned,
        message: "Codexが決めた直接操作はプレビューのみです。現在のComputer Useで確認して実行してください。Jevの判断数には含めません",
        elapsedMs: Date.now() - startedAt,
      });
    }
    if (verify && await verify(observation)) {
      return finish("done", { steps: step - 1, tracePath, verified: true, elapsedMs: Date.now() - startedAt });
    }
    const stepGoal = planned.jevGoal ?? goal;

    let candidates = selectCandidates(parseAX(observation), stepGoal, { max: candidateMax });
    // 观测不足以支撑决策时（例如上一动作返回的 diff 里没有可解析元素），换成完整树重试一次
    if (candidates.length < 2) {
      observation = await driver.observe({ full: true });
      candidates = selectCandidates(parseAX(observation), stepGoal, { max: candidateMax });
      if (candidates.length < 2) {
        record({ event: "no_candidates", step });
        return finish("escalate", {
          steps: step - 1,
          tracePath,
          message: "候補要素が不足しているため判断できません",
          elapsedMs: Date.now() - startedAt,
        });
      }
    }
    if (candidates.clipped) {
      emit(`[step ${step}] 候補を絞り込みました: ${candidates.totalClickable} → ${candidateMax}（役割と関連度の順）`);
    }

    let decision;
    try {
      decision = await decide({
        goal: stepGoal,
        app: appName,
        candidates,
        context: buildContext(observation),
        recentActions,
        constraints: [planned.jevPlan ?? "", plan ? `Plan (from planner): ${plan}` : "", constraints].filter(Boolean).join("\n"),
        ...jevOptions,
      });
    } catch (err) {
      record({ event: "decide_error", step, message: err.message });
      return { status: "error", step, message: err.message, tracePath };
    }

    const selected = candidates.find(c => c.index === decision.targetIndex);
    const invalidTarget = decision.targetIndex != null && !selected;
    if (invalidTarget) {
      return finish("escalate", { steps: step - 1, tracePath, message: "対象が現在の候補にありません", elapsedMs: Date.now() - startedAt });
    }
    // The model-facing description is lossy. Policy must use the selected
    // observation's full label, including when a custom adapter supplies a label.
    if (selected) decision = { ...decision, targetLabel: selected.label };
    const gate = evaluatePolicy({ decision, app: appName, allowedApps, step, maxSteps, thresholds, dryRun });
    const target = decision.targetIndex != null ? `i${decision.targetIndex} (${decision.targetLabel ?? "?"})` : "—";
    const line =
      `[step ${step}] Jev ${decision.latencyMs}ms · ${decision.action ?? "?"} ${target} · ` +
      `conf=${fmt(decision.confidence)} risk=${fmt(decision.risk)} done=${fmt(decision.done)} → ${gate.verdict}` +
      (gate.reasons.length ? ` · ${gate.reasons.join("；")}` : "");
    emit(line);
    record({ event: "step", step, candidates: candidates.length, decision: stripRaw(decision), gate });

    if (gate.verdict === "done" && (verify || stepGoal !== goal)) {
      return finish("escalate", { steps: step - 1, tracePath, decision, message: "Jevは完了と判断しましたが、全体目標は未確認です。現在の画面を確認してください", elapsedMs: Date.now() - startedAt });
    }
    if (gate.verdict === "done") {
      return finish("done", { steps: step - 1, tracePath, decision, gate, elapsedMs: Date.now() - startedAt });
    }
    if (gate.verdict !== "proceed") {
      return finish(gate.verdict, { steps: step - 1, tracePath, decision, gate, elapsedMs: Date.now() - startedAt });
    }
    if (dryRun) {
      return finish("dry_run", {
        steps: 0,
        tracePath,
        planned: { action: decision.action, targetIndex: decision.targetIndex, targetLabel: decision.targetLabel },
        gate,
        elapsedMs: Date.now() - startedAt,
      });
    }

    const tAct = Date.now();
    // 参数既可以是一份静态配置，也可以是按步生成的回调（Planner 决定"做什么"，Jev 决定"点哪里"）
    const stepResources = typeof resources === "function" ? ((await resources(step, decision)) ?? {}) : resources;
    try {
      await executeAction(driver, decision, stepResources);
    } catch (err) {
      record({ event: "action_error", step, message: err.message });
      return finish("error", { steps: step, tracePath, message: `操作に失敗しました: ${err.message}`, elapsedMs: Date.now() - startedAt });
    }
    const actMs = Date.now() - tAct;

    const previousObservation = observation;
    observation = await driver.observe({ full: true });
    const noChange = observation === previousObservation;
    recentActions.push(`${decision.action} i${decision.targetIndex} → ${noChange ? "no change" : "changed"}`);
    emit(`         └ 操作 ${actMs}ms · ${noChange ? "画面は変わっていません" : "画面が変わりました"}`);
    record({ event: "action", step, actMs, noChange, action: decision.action, targetIndex: decision.targetIndex });
  }

  if (verify && await verify(observation)) {
    return finish("done", { steps: maxSteps, tracePath, verified: true, elapsedMs: Date.now() - startedAt });
  }
  return finish("max_steps", { steps: maxSteps, tracePath, elapsedMs: Date.now() - startedAt });

  function finish(status, extra) {
    record({ event: "finish", status, ...extra });
    emit(`[jev-use] 終了: ${status} · 所要時間 ${(extra.elapsedMs / 1000).toFixed(1)}s · trace=${tracePath}`);
    return { status, ...extra };
  }
}

async function executeAction(driver, decision, resources) {
  switch (decision.action) {
    case "click_element":
      if (Array.isArray(resources.at)) return driver.click(resources.at);
      return driver.click(decision.targetIndex, resources.mouseButton ? { mouseButton: resources.mouseButton } : undefined);
    case "click_at":
      return driver.click(resources.at);
    case "drag":
      return driver.drag(resources.from, resources.to);
    case "set_value":
      return driver.setValue(decision.targetIndex, String(resources.text ?? ""));
    case "type_text":
      return driver.typeText(String(resources.text ?? ""));
    case "press_key":
      return driver.pressKey(String(resources.key ?? "Return"));
    case "scroll":
      return driver.scroll(decision.targetIndex, String(resources.direction ?? "down"), 1);
    case "wait":
      return sleep(500);
    default:
      throw new Error(`未対応の操作: ${decision.action}`);
  }
}

const fmt = (n) => (typeof n === "number" ? n.toFixed(2) : "n/a");
const stripRaw = ({ raw, ...rest }) => rest;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 瞬时的基础设施错误（ScreenCaptureKit/无效参数）自动重试 */
export async function withRetry(fn, { attempts = 3, delayMs = 350 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transient = /ScreenCaptureKit|invalid parameter|-10005|timeout/i.test(String(err));
      if (!transient || i === attempts - 1) throw err;
      await sleep(delayMs);
    }
  }
  throw lastErr;
}
