import { normalizeAiTransactions, type ParseResult } from "./finance";

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/" +
  GEMINI_MODEL +
  ":generateContent";

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function parsePdfWithGemini(file: File, apiKey: string): Promise<ParseResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55_000);

  try {
    const prompt =
      "你是银行和支付流水的逐笔提取器。读取整个 PDF 的每一页，只提取真实交易行，不要提取表头、页码、统计说明或证明编号。" +
      "每笔必须包含 date、description、amount、direction。date 使用 YYYY-MM-DD；amount 只能取金额列，不得使用年份、时间、订单号、页码或账户号；" +
      "收入写 income，支出以及收支标记为其他或斜杠的资金流动写 expense。不要合并相同交易，不要计算或猜测缺失金额。";
    const response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: prompt },
          { inlineData: { mimeType: "application/pdf", data: arrayBufferToBase64(await file.arrayBuffer()) } },
        ] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 32768,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              transactions: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    date: { type: "STRING" },
                    description: { type: "STRING" },
                    amount: { type: "NUMBER" },
                    direction: { type: "STRING", enum: ["income", "expense"] },
                  },
                  required: ["date", "description", "amount", "direction"],
                },
              },
            },
            required: ["transactions"],
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Gemini PDF extraction returned ${response.status}`);

    const payload = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("") ?? "";
    if (!text) throw new Error("Gemini PDF extraction returned no content");
    return normalizeAiTransactions(JSON.parse(text));
  } finally {
    clearTimeout(timeoutId);
  }
}
