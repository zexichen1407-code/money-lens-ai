import { parseStatement } from "../../../lib/finance";
import { parsePdfWithGemini } from "../../../lib/gemini-statement";

export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_UPLOAD_BYTES + 100_000) {
    return Response.json({ error: "文件超过 4MB。请缩小日期范围后重新导出。" }, { status: 413 });
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "没有收到可解析的流水文件。" }, { status: 400 });
    }

    let result;
    try {
      result = await parseStatement(file);
    } catch (deterministicError) {
      const extension = file.name.split(".").pop()?.toLowerCase();
      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (extension !== "pdf" || !apiKey) throw deterministicError;

      try {
        result = await parsePdfWithGemini(file, apiKey);
      } catch (aiError) {
        console.error(
          "PDF extraction failed:",
          deterministicError instanceof Error ? deterministicError.message : "Unknown parser error",
          aiError instanceof Error ? aiError.message : "Unknown AI error",
        );
        throw new Error("这份 PDF 无法可靠分列，AI 识别也暂时不可用。请上传同期间的 XLSX 或 CSV。");
      }
    }
    return Response.json({ result }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "文件解析失败，请换一份流水重试。" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
