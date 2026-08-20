import type { ParseResult } from "./finance";
import { MAX_STATEMENT_FILES, MAX_STATEMENT_FILE_BYTES } from "./upload-constraints";

export async function uploadStatements(files: File[]): Promise<ParseResult> {
  if (files.length < 1 || files.length > MAX_STATEMENT_FILES) {
    throw new Error(`请选择 1 至 ${MAX_STATEMENT_FILES} 个流水文件。`);
  }
  const oversizedFile = files.find((file) => file.size > MAX_STATEMENT_FILE_BYTES);
  if (oversizedFile) {
    throw new Error(`${oversizedFile.name} 超过 4MB，请缩小日期范围后重新导出。`);
  }

  const form = new FormData();
  files.forEach((file) => form.append("files", file, file.name));

  const response = await fetch("/api/parse", {
    method: "POST",
    body: form,
  });
  const payload = await response.json() as { result?: ParseResult; error?: unknown };

  if (!response.ok || !payload.result) {
    throw new Error(
      typeof payload.error === "string" ? payload.error : "文件解析失败，请换一份流水重试。",
    );
  }

  return payload.result;
}
