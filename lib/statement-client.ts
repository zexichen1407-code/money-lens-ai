import type { ParseResult } from "./finance";

export async function uploadStatement(file: File): Promise<ParseResult> {
  const form = new FormData();
  form.set("file", file, file.name);

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
