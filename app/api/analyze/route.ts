const GEMINI_MODEL = "gemini-3.5-flash-lite";
export const maxDuration = 60;
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/" +
  GEMINI_MODEL +
  ":generateContent";

const ALLOWED_CATEGORIES = new Set([
  "餐饮", "交通", "购物", "居住", "娱乐",
  "医疗", "教育", "金融", "转账", "其他",
]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedNumber(value: unknown, min = -1_000_000_000, max = 1_000_000_000) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : null;
}

function dateText(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : null;
}

function monthText(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value)
    ? value
    : null;
}

function sanitizeMetrics(input: unknown) {
  const metrics = record(input);
  const period = record(metrics?.period);
  const sample = record(metrics?.sample);
  const cashflow = record(metrics?.cashflow);
  const signals = record(metrics?.signals);
  const start = dateText(period?.start);
  const end = dateText(period?.end);
  const transactionCount = boundedNumber(sample?.transactionCount, 1, 100_000);

  if (!metrics || !start || !end || transactionCount === null) return null;

  const trend = Array.isArray(metrics.trend)
    ? metrics.trend.slice(0, 24).map(record).filter(Boolean).map((point) => ({
        month: monthText(point?.month),
        income: boundedNumber(point?.income, 0),
        outflow: boundedNumber(point?.outflow, 0),
        net: boundedNumber(point?.net),
      })).filter((point) => point.month)
    : [];

  const categoryMix = Array.isArray(metrics.categoryMix)
    ? metrics.categoryMix.slice(0, 12).map(record).filter(Boolean).map((category) => ({
        name: typeof category?.name === "string" && ALLOWED_CATEGORIES.has(category.name)
          ? category.name
          : "其他",
        amount: boundedNumber(category?.amount, 0),
        share: boundedNumber(category?.share, 0, 1),
      }))
    : [];

  return {
    period: { start, end },
    sample: {
      transactionCount,
      ignoredRows: boundedNumber(sample?.ignoredRows, 0, 100_000),
    },
    cashflow: {
      income: boundedNumber(cashflow?.income, 0),
      outflow: boundedNumber(cashflow?.outflow, 0),
      consumptionExcludingTransfers: boundedNumber(cashflow?.consumptionExcludingTransfers, 0),
      transferOutflow: boundedNumber(cashflow?.transferOutflow, 0),
      net: boundedNumber(cashflow?.net),
      savingsRate: boundedNumber(cashflow?.savingsRate, -100, 100),
      cashflowScore: boundedNumber(cashflow?.cashflowScore, 0, 100),
    },
    trend,
    categoryMix,
    signals: {
      latestMonthOutflowChange: boundedNumber(signals?.latestMonthOutflowChange, -100, 100),
      largestSingleOutflow: boundedNumber(signals?.largestSingleOutflow, 0),
      recurringMerchantCount: boundedNumber(signals?.recurringMerchantCount, 0, 100_000),
      recurringOutflow: boundedNumber(signals?.recurringOutflow, 0),
    },
  };
}

function normalizeReport(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI response is not JSON");
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  const insights = Array.isArray(parsed.insights)
    ? parsed.insights.filter((item): item is string => typeof item === "string").slice(0, 4)
    : [];
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions.filter((item): item is string => typeof item === "string").slice(0, 4)
    : [];
  if (typeof parsed.summary !== "string" || insights.length < 2 || actions.length < 2) {
    throw new Error("AI response is incomplete");
  }
  return { summary: parsed.summary.slice(0, 220), insights, actions };
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: "AI 服务尚未配置，请联系站点管理员。" }, { status: 503 });
  }

  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 20_000) {
      return Response.json({ error: "分析数据过大。" }, { status: 413 });
    }
    const body = record(await request.json());
    const metrics = sanitizeMetrics(body?.metrics);
    if (!metrics) {
      return Response.json({ error: "分析数据格式不正确。" }, { status: 400 });
    }

    const prompt =
      "你是谨慎的个人现金流分析助手。只根据以下匿名汇总指标回答，不推断总资产、负债、信用或投资能力；不要推荐借贷或投资。输出严格 JSON：" +
      '{"summary":"80字内总体判断并说明边界","insights":["2到4条有数字依据的发现"],"actions":["2到4条本月可执行建议"]}。数据不足时明确说明。汇总指标：' +
      JSON.stringify(metrics);

    const response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 700,
          responseMimeType: "application/json",
        },
      }),
    });
    if (!response.ok) {
      console.error("Gemini API error:", response.status);
      throw new Error("Gemini API returned " + response.status);
    }

    const result = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("") ?? "";
    return Response.json(normalizeReport(text), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(
      "Gemini analysis failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return Response.json(
      { error: "免费 AI 额度暂时不可用，已保留基础分析。" },
      { status: 502 },
    );
  }
}
