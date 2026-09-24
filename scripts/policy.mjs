/**
 * Computer Use の確認条件をコードで評価する副作用のないゲート。
 */

export const DEFAULT_ALLOWED_APPS = [
  "Calendar",
  "Calculator",
  "TextEdit",
  "NetEaseMusic",
  "Figma",
  "Google Chrome",
  "Codex In-app Browser",
  "カレンダー",
  "計算機",
  "テキストエディット",
];

/** 対象ラベルが該当するときは実行前に確認する。 */
export const SENSITIVE_LABEL_PATTERNS = [
  { id: "delete", re: /删除|移除|清空|削除|消去|破棄|退会|delete|remove/i },
  { id: "send", re: /发送|提交|发布|回复|送信|提出|公開|返信|投稿|申し込む|申込|send|submit|post|reply/i },
  { id: "payment", re: /支付|付款|购买|下单|充值|订阅|开通|支払|購入|注文|決済|課金|定期購読|pay|purchase|buy|subscribe|checkout/i },
  { id: "auth", re: /授权|权限|登录|密码|验证码|権限|許可|ログイン|サインイン|認証|パスワード|暗証番号|authorize|permission|sign in|login|password|captcha/i },
  { id: "share", re: /上传|分享|导出|アップロード|共有|書き出し|エクスポート|upload|share|export/i },
  { id: "install", re: /安装|インストール|install/i },
  { id: "settings", re: /系统设置|偏好设置|安全设置|システム設定|環境設定|セキュリティ設定|system settings|security settings/i },
];

export const DEFAULT_THRESHOLDS = {
  doneProbability: 0.9,
  riskConfirm: 0.2,
  minConfidence: 0.5,
  lowRiskMinConfidence: 0.4,
  stopConfidence: 0.3,
};

/** 計算機の数値入力だけ、対象確信度の下限を少し緩める。 */
export const LOW_RISK_APPS = ["Calculator", "計算機"];

export function matchSensitive(label = "") {
  const text = String(label).normalize("NFKC");
  return SENSITIVE_LABEL_PATTERNS.find((p) => p.re.test(text)) ?? null;
}

/**
 * @param {object} input
 * @param {object} input.decision normalizeDecision の出力
 * @param {string} input.app
 * @param {string[]} [input.allowedApps]
 * @param {number} [input.step]
 * @param {number} [input.maxSteps]
 * @param {object} [input.thresholds]
 * @param {boolean} [input.dryRun]
 * @returns {{verdict:"proceed"|"done"|"confirm"|"escalate"|"stop", kind?:string, reasons:string[]}}
 */
export function evaluatePolicy({
  decision,
  app,
  allowedApps = null,
  step = 1,
  maxSteps = 30,
  thresholds = DEFAULT_THRESHOLDS,
  dryRun = false,
}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const fmt = (n) => (typeof n === "number" ? n.toFixed(2) : "n/a");

  if (step > maxSteps) {
    return { verdict: "stop", kind: "budget", reasons: [`step ${step} が上限 ${maxSteps} を超えました`] };
  }
  if (typeof decision?.done === "number" && decision.done >= t.doneProbability) {
    return { verdict: "done", reasons: [`完了確率 ${fmt(decision.done)}`] };
  }

  const reasons = [];
  if (allowedApps && !allowedApps.includes(app)) reasons.push(`アプリ「${app}」は許可リスト外です`);
  const sensitive = matchSensitive(decision?.targetLabel);
  if (sensitive) reasons.push(`対象は「${sensitive.id}」に該当する可能性があります: ${decision.targetLabel}`);
  if (typeof decision?.risk === "number" && decision.risk >= t.riskConfirm) {
    reasons.push(`Jev のリスク判定 ${fmt(decision.risk)} ≥ ${t.riskConfirm}`);
  }
  if (decision?.action === "ask_user") reasons.push("Jev がユーザーへの確認を選びました");
  if (reasons.length) return { verdict: "confirm", kind: "sensitive", reasons, dryRun };

  if (![decision?.confidence, decision?.risk, decision?.done].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) {
    return { verdict: "escalate", kind: "invalid_decision", reasons: ["判断確率が欠落しているか、0–1の範囲外です"] };
  }
  if (typeof decision?.confidence === "number" && decision.confidence < t.stopConfidence) {
    return { verdict: "stop", kind: "low_confidence", reasons: [`対象の確信度 ${fmt(decision.confidence)} < ${t.stopConfidence}`] };
  }
  const minConfidence = LOW_RISK_APPS.includes(app) ? t.lowRiskMinConfidence : t.minConfidence;
  if (typeof decision?.confidence === "number" && decision.confidence < minConfidence) {
    return {
      verdict: "escalate",
      kind: "low_confidence",
      reasons: [`対象の確信度 ${fmt(decision.confidence)} < ${minConfidence}`],
      minConfidence,
    };
  }
  if (decision?.targetIndex == null && decision?.action !== "wait") {
    return { verdict: "escalate", kind: "no_target", reasons: ["対象要素が選ばれていません"] };
  }

  return { verdict: "proceed", reasons: [] };
}
