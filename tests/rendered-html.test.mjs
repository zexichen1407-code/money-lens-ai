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

function createSignedBankPdf() {
  const stream = [
    "BT",
    "/F1 10 Tf",
    "1 0 0 1 50 750 Tm (date) Tj",
    "1 0 0 1 150 750 Tm (amount) Tj",
    "1 0 0 1 220 750 Tm (direction) Tj",
    "1 0 0 1 320 750 Tm (details) Tj",
    "1 0 0 1 50 730 Tm (20260531) Tj",
    "1 0 0 1 150 730 Tm (+100.00) Tj",
    "1 0 0 1 220 730 Tm (credit) Tj",
    "1 0 0 1 320 730 Tm (salary) Tj",
    "1 0 0 1 50 710 Tm (20260601) Tj",
    "1 0 0 1 150 710 Tm (-25.00) Tj",
    "1 0 0 1 220 710 Tm (debit) Tj",
    "1 0 0 1 320 710 Tm (coffee) Tj",
    "1 0 0 1 50 690 Tm (20260602) Tj",
    "1 0 0 1 150 690 Tm (+999.00) Tj",
    "1 0 0 1 220 690 Tm (/) Tj",
    "1 0 0 1 320 690 Tm (neutral) Tj",
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];

  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body);
}

test("server-renders the internal Aba Rural Commercial Bank upload experience and metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>阿坝农商银行内部 AI 财务分析工具<\/title>/);
  assert.match(html, /阿坝农商银行/);
  assert.match(html, /accept=".csv,.xlsx,.pdf"/);
  assert.match(html, /使用示例数据体验完整 AI 分析/);
  assert.match(html, /原文件不保存/);
  assert.doesNotMatch(html, /money-lens\.test\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/);
});

test("parses every uploaded file with local code and sends only anonymous summaries to Qwen", async () => {
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
  assert.match(page, /内部使用 · 无需登录/);
  assert.match(finance, /file\.arrayBuffer\(\)/);
  assert.match(finance, /import\("unpdf"\)/);
  assert.match(finance, /parsePdfByCoordinates/);
  assert.match(finance, /amountColumnCenter/);
  assert.match(finance, /directionColumnCenter/);
  assert.match(finance, /recognizedRowCount \/ dateCandidateCount/);
  assert.match(finance, /不计收支\|中性/);
  assert.match(finance, /检测到年份被误识别为金额/);
  assert.match(finance, /document\.numPages > 1000/);
  assert.match(finance, /replace\(\/\\p\{M\}\/gu/);
  assert.doesNotMatch(finance, /pdfjs-dist/);
  assert.match(upload, /fetch\("\/api\/parse"/);
  assert.match(parseApi, /request\.formData\(\)/);
  assert.match(parseApi, /parseStatement\(file\)/);
  assert.match(parseApi, /Cache-Control/);
  assert.doesNotMatch(parseApi, /fetch\(|GEMINI|DASHSCOPE|parsePdfWith/i);
  assert.match(finance, /buildAiPayload/);
  assert.match(finance, /transactionCount/);
  assert.match(ai, /fetch\("\/api\/analyze"/);
  assert.match(ai, /buildAiPayload/);
  assert.match(api, /qwen3\.6-flash/);
  assert.match(api, /dashscope\.aliyuncs\.com/);
  assert.match(api, /sanitizeMetrics/);
  assert.match(api, /process\.env\.DASHSCOPE_API_KEY/);
  assert.match(report, /不会发送给任何 AI/);
  assert.match(page, /带文字层的 PDF/);
  assert.doesNotMatch(page + report + ai + api, /puter|登录 Puter|AI Gateway|Gemini|huggingface/i);
  assert.doesNotMatch(page + finance, /localStorage|sessionStorage/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton|@heyputer|@huggingface|"xlsx"/);
  assert.match(packageJson, /read-excel-file/);
  assert.match(finance, /const \{ readSheet \} = await import\("read-excel-file\/browser"\)/);
  assert.doesNotMatch(finance, /default: readXlsxFile/);
  assert.match(packageJson, /unpdf/);
  assert.match(hosting, /"d1": null/);
  assert.match(hosting, /"r2": null/);
  assert.match(layout, /generateMetadata/);
  assert.doesNotMatch(layout, /og\.png/);
  await access(new URL("../public/og.png", import.meta.url));
});

test("upload route parses a CSV statement on the server", async () => {
  const form = new FormData();
  form.set("file", new File([
    "交易日期,交易类型,交易对方,交易金额,收/支\n2026-01-01,转账,公司,10000,收入\n2026-01-02,商户消费,餐厅,88,支出\n2026-01-03,资金划转,余额宝,37800,其他\n",
  ], "statement.csv", { type: "text/csv" }));
  const response = await render("/api/parse", { method: "POST", body: form });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.result.format, "CSV");
  assert.equal(payload.result.transactions.length, 2);
  assert.equal(payload.result.ignoredRows, 1);
  assert.equal(payload.result.transactions.find((item) => item.direction === "income")?.amount, 10000);
  assert.equal(payload.result.transactions.find((item) => item.direction === "expense")?.amount, 88);
});

test("upload route parses compact dates and signed amounts in a bank PDF", async () => {
  const form = new FormData();
  form.set("file", new File([createSignedBankPdf()], "bank-statement.pdf", { type: "application/pdf" }));
  const response = await render("/api/parse", { method: "POST", body: form });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.result.format, "PDF");
  assert.equal(payload.result.transactions.length, 2);
  assert.equal(payload.result.transactions.find((item) => item.direction === "income")?.amount, 100);
  assert.equal(payload.result.transactions.find((item) => item.direction === "expense")?.amount, 25);
});

test("AI route fails safely when the developer key is absent", async () => {
  const existingKey = process.env.DASHSCOPE_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
  try {
    const response = await render("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 503);
    assert.match(await response.text(), /AI 服务尚未配置/);
  } finally {
    if (existingKey) process.env.DASHSCOPE_API_KEY = existingKey;
  }
});
