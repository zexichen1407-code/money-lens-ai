import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("https://money-lens.test/", {
      headers: {
        accept: "text/html",
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
  assert.match(html, /原文件不上云/);
  assert.match(html, /https:\/\/money-lens\.test\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/);
});

test("keeps raw files local and sends only aggregate metrics to AI", async () => {
  const [page, report, finance, ai, layout, packageJson, hosting] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/FinanceReport.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/finance.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/puter-ai.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /parseStatement/);
  assert.match(page, /createSampleResult/);
  assert.match(page, /requestAiReport/);
  assert.match(page, /https:\/\/js\.puter\.com\/v2\//);
  assert.match(finance, /file\.arrayBuffer\(\)/);
  assert.match(finance, /buildAiPayload/);
  assert.match(finance, /transactionCount/);
  assert.doesNotMatch(ai, /description|merchant|account|账号|商户/);
  assert.match(ai, /只基于给定的聚合流水指标/);
  assert.match(report, /不含姓名、账号、商户名称和单笔明细/);
  assert.doesNotMatch(page + finance, /localStorage|sessionStorage/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton|@heyputer|"xlsx"/);
  assert.match(packageJson, /read-excel-file/);
  assert.match(packageJson, /pdfjs-dist/);
  assert.match(hosting, /"d1": null/);
  assert.match(hosting, /"r2": null/);
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /og\.png/);
  await access(new URL("../public/og.png", import.meta.url));
});
