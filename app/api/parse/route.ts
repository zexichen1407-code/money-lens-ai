import { parseStatement } from "../../../lib/finance";

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

    const result = await parseStatement(file);
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
