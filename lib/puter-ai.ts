import { buildAiPayload, type FinanceSummary } from "./finance";

export interface AiReport {
  summary: string;
  insights: string[];
  actions: string[];
  aiPowered: boolean;
}

interface PuterResponse {
  text?: string;
  message?: { content?: string | Array<{ text?: string }> };
}

declare global {
  interface Window {
    puter?: {
      ai: {
        chat: (
          prompt: string | Array<{ role: string; content: string }>,
          options?: Record<string, unknown>,
        ) => Promise<string | PuterResponse>;
      };
    };
  }
}

function formatPercent(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "" : "-"}${Math.abs(value * 100).toFixed(1)}%`;
}

function waitForPuter(timeout = 8_000) {
  return new Promise<NonNullable<Window["puter"]>>((resolve, reject) => {
    const startedAt = Date.now();
    const poll = window.setInterval(() => {
      if (window.puter) {
        window.clearInterval(poll);
        resolve(window.puter);
      } else if (Date.now() - startedAt > timeout) {
        window.clearInterval(poll);
        reject(new Error("AI 服务加载超时"));
      }
    }, 120);
  });
}

function extractResponseText(response: string | PuterResponse) {
  if (typeof response === "string") return response;
  if (typeof response.text === "string") return response.text;
  const content = response.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => item.text ?? "").join("");
  throw new Error("AI 返回格式无法识别");
}

function parseAiJson(text: string): Omit<AiReport, "aiPowered"> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI 未返回结构化结果");
  const parsed = JSON.parse(match[0]) as Partial<AiReport>;
  if (
    typeof parsed.summary !== "string" ||
    !Array.isArray(parsed.insights) ||
    !Array.isArray(parsed.actions)
  ) throw new Error("AI 结果字段不完整");

  return {
    summary: parsed.summary.slice(0, 220),
    insights: parsed.insights.filter((item): item is string => typeof item === "string").slice(0, 4),
    actions: parsed.actions.filter((item): item is string => typeof item === "string").slice(0, 4),
  };
}

export function fallbackReport(summary: FinanceSummary): AiReport {
  const savingsText =
    summary.savingsRate === null
      ? "当前流水没有识别到稳定收入，无法计算结余率"
      : summary.savingsRate >= 0
        ? `本期结余率为 ${formatPercent(summary.savingsRate)}，净现金流保持为正`
        : `本期支出超过收入，结余率为 ${formatPercent(summary.savingsRate)}`;
  const trendText =
    summary.latestMonthChange === null
      ? "月份样本不足，暂时不能判断支出趋势"
      : `最近一个月流出较上月${summary.latestMonthChange >= 0 ? "增加" : "减少"} ${formatPercent(Math.abs(summary.latestMonthChange))}`;
  const categoryText = summary.topCategory
    ? `${summary.topCategory.name}是最大的非转账支出类别，占全部流出的 ${formatPercent(summary.topCategory.share)}`
    : "暂未形成明确的消费类别结构";

  return {
    summary: `${summary.scoreLabel}。本报告依据 ${summary.transactionCount} 笔已识别流水，只反映所上传区间内的现金流，不代表完整资产负债状况。`,
    insights: [savingsText, trendText, categoryText],
    actions: [
      summary.topCategory
        ? `先复核“${summary.topCategory.name}”中的大额或重复消费，找出一项可在下月减少的支出。`
        : "补充更完整的流水区间，再判断主要支出方向。",
      "把转账与真实消费分开核对，避免内部账户划转被误当作生活开销。",
      "连续上传至少 3 个月流水，用同一口径观察结余率和月度流出变化。",
    ],
    aiPowered: false,
  };
}

export async function requestAiReport(summary: FinanceSummary): Promise<AiReport> {
  const puter = window.puter ?? await waitForPuter();
  const response = await puter.ai.chat([
    {
      role: "system",
      content:
        "你是谨慎的个人现金流分析助手。只基于给定的聚合流水指标回答，不推断用户的总资产、负债、信用、投资能力或收入稳定性；不要承诺收益，不提供借贷或投资推荐。用简洁中文输出严格 JSON，不要使用 Markdown。",
    },
    {
      role: "user",
      content: `请分析以下已脱敏聚合数据：${JSON.stringify(buildAiPayload(summary))}。返回格式：{"summary":"80字内总体判断并说明边界","insights":["2到4条有数字依据的发现"],"actions":["2到4条本月可执行建议"]}。建议必须能从数据中推出；数据期不足时明确说不足。`,
    },
  ]);
  return { ...parseAiJson(extractResponseText(response)), aiPowered: true };
}

