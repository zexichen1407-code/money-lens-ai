import { parseStatement, type ParseResult } from "../../../lib/finance";
import { MAX_STATEMENT_FILES, MAX_STATEMENT_FILE_BYTES } from "../../../lib/upload-constraints";

export const maxDuration = 60;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_STATEMENT_FILES * MAX_STATEMENT_FILE_BYTES + 300_000) {
    return Response.json(
      { error: "上传文件总大小超出限制。最多上传 3 个文件，每个不超过 4MB。" },
      { status: 413 },
    );
  }

  try {
    const form = await request.formData();
    const uploadedFiles = form.getAll("files").filter((value): value is File => value instanceof File);
    const legacyFile = form.get("file");
    const files = uploadedFiles.length > 0
      ? uploadedFiles
      : legacyFile instanceof File
        ? [legacyFile]
        : [];

    if (files.length < 1) {
      return Response.json({ error: "没有收到可解析的流水文件。" }, { status: 400 });
    }
    if (files.length > MAX_STATEMENT_FILES) {
      return Response.json({ error: `最多上传 ${MAX_STATEMENT_FILES} 个流水文件。` }, { status: 400 });
    }
    const oversizedFile = files.find((file) => file.size > MAX_STATEMENT_FILE_BYTES);
    if (oversizedFile) {
      return Response.json(
        { error: `${oversizedFile.name} 超过 4MB，请缩小日期范围后重新导出。` },
        { status: 413 },
      );
    }

    const parsedResults: ParseResult[] = [];
    for (const file of files) {
      try {
        parsedResults.push(await parseStatement(file));
      } catch (error) {
        const message = error instanceof Error ? error.message : "文件解析失败";
        throw new Error(`${file.name}：${message}`);
      }
    }

    const formats = new Set(parsedResults.map((result) => result.format));
    const result: ParseResult = {
      transactions: parsedResults
        .flatMap((parsed, fileIndex) => parsed.transactions.map((transaction) => ({
          ...transaction,
          id: `${fileIndex + 1}-${transaction.id}`,
        })))
        .sort((a, b) => a.date.localeCompare(b.date)),
      ignoredRows: parsedResults.reduce((sum, parsed) => sum + parsed.ignoredRows, 0),
      format: formats.size === 1 ? parsedResults[0].format : "混合",
    };

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
