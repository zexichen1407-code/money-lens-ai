import { buildAiPayload, type FinanceSummary } from "./finance";

export interface AiReport {
  summary: string;
  insights: string[];
  actions: string[];
  aiPowered: boolean;
}

interface WorkerResponse {
  type: "progress" | "result" | "error";
  message?: string;
  text?: string;
}

function formatPercent(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "" : "-"}${Math.abs(value * 100).toFixed(1)}%`;
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

export async function requestAiReport(
  summary: FinanceSummary,
  onProgress?: (message: string) => void,
): Promise<AiReport> {
  if (typeof Worker === "undefined") throw new Error("当前浏览器不支持本地 AI");

  const worker = new Worker(new URL("../app/local-ai.worker.ts", import.meta.url), {
    type: "module",
  });

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("本地 AI 运行超时"));
    }, 240_000);

    const finish = () => {
      window.clearTimeout(timeout);
      worker.terminate();
    };

    worker.onerror = () => {
      finish();
      reject(new Error("本地 AI 模型加载失败"));
    };

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.type === "progress") {
        onProgress?.(response.message ?? "正在准备本地 AI…");
        return;
      }
      if (response.type === "error") {
        finish();
        reject(new Error(response.message ?? "本地 AI 运行失败"));
        return;
      }
      if (response.type === "result" && response.text) {
        try {
          const report = parseAiJson(response.text);
          finish();
          resolve({ ...report, aiPowered: true });
        } catch (error) {
          finish();
          reject(error);
        }
      }
    };

    worker.postMessage({ payload: buildAiPayload(summary) });
  });
}

