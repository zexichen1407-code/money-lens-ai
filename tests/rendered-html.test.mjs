import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("https://money-lens.test" + path, { ...init,
      headers: {
        accept: "text/html", ...Object.fromEntries(new Headers(init.headers).entries()),
        host: "money-lens.test",
        "x-forwarded-host": "money-lens.test",
        "x-forwarded-proto": "https",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Money Lens upload experience and metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>钱镜 AI｜个人流水财务体检<\/title>/);
  assert.match(html, /让每一笔流水/);
  assert.match(html, /accept=".csv,.xlsx,.pdf"/);
  assert.match(html, /使用示例数据体验完整 AI 分析/);
  assert.match(html, /原文件不保存/);
  assert.match(html, /https:\/\/money-lens\.test\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/);
});

test("parses uploads ephemerally and sends only allowlisted aggregates to Gemini", async () => {
  const [page, report, finance, upload, parseApi, ai, api, layout, packageJson, hosting] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/FinanceReport.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/statement-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/parse/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/analyze/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /uploadStatement/);
  assert.match(page, /createSampleResult/);
  assert.match(page, /requestAiReport/);
  assert.match(page, /云端即时解析 · 无需登录/);
  assert.match(finance, /file\.arrayBuffer\(\)/);
  assert.match(finance, /import\("unpdf"\)/);
  assert.doesNotMatch(finance, /pdfjs-dist/);
  assert.match(upload, /fetch\("\/api\/parse"/);
  assert.match(parseApi, /request\.formData\(\)/);
  assert.match(parseApi, /parseStatement\(file\)/);
  assert.match(parseApi, /Cache-Control/);
  assert.match(finance, /buildAiPayload/);
  assert.match(finance, /transactionCount/);
  assert.match(ai, /fetch\("\/api\/analyze"/);
  assert.match(ai, /buildAiPayload/);
  assert.match(api, /gemini-3\.5-flash-lite/);
  assert.match(api, /x-goog-api-key/);
  assert.match(api, /sanitizeMetrics/);
  assert.match(api, /process\.env\.GEMINI_API_KEY/);
  assert.match(report, /仅在当前请求内解析，不写入数据库或对象存储/);
  assert.doesNotMatch(page + report + ai + api, /puter|登录 Puter|AI Gateway|Qwen|huggingface/i);
  assert.doesNotMatch(page + finance, /localStorage|sessionStorage/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton|@heyputer|@huggingface|"xlsx"/);
  assert.match(packageJson, /read-excel-file/);
  assert.match(finance, /const \{ readSheet \} = await import\("read-excel-file\/browser"\)/);
  assert.doesNotMatch(finance, /default: readXlsxFile/);
  assert.match(packageJson, /unpdf/);
  assert.match(hosting, /"d1": null/);
  assert.match(hosting, /"r2": null/);
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /og\.png/);
  await access(new URL("../public/og.png", import.meta.url));
});

test("upload route parses a CSV statement on the server", async () => {
  const form = new FormData();
  form.set("file", new File([
    "交易日期,交易对方,交易金额,收支\n2026-01-01,工资,10000,收入\n2026-01-02,餐厅,88,支出\n",
  ], "statement.csv", { type: "text/csv" }));
  const response = await render("/api/parse", { method: "POST", body: form });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.result.format, "CSV");
  assert.equal(payload.result.transactions.length, 2);
});

test("AI route fails safely when the developer key is absent", async () => {
  const existingKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const response = await render("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 503);
    assert.match(await response.text(), /AI 服务尚未配置/);
  } finally {
    if (existingKey) process.env.GEMINI_API_KEY = existingKey;
  }
});
