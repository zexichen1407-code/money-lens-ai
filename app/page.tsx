"use client";

import { useRef, useState } from "react";
import FinanceReport from "./FinanceReport";
import {
  analyzeTransactions,
  createSampleResult,
  type FinanceSummary,
  type ParseResult,
  type Transaction,
} from "../lib/finance";
import { uploadStatements } from "../lib/statement-client";
import { MAX_STATEMENT_FILES, MAX_STATEMENT_FILE_BYTES } from "../lib/upload-constraints";
import {
  fallbackReport,
  requestAiReport,
  type AiReport,
} from "../lib/ai-client";

type Phase = "idle" | "parsing" | "calculating" | "ai" | "done";

const PHASE_COPY: Record<Exclude<Phase, "idle" | "done">, string> = {
  parsing: "正在安全上传并解析流水…",
  calculating: "正在计算收支与消费结构…",
  ai: "正在请求 AI 生成解读…",
};

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [sourceLabel, setSourceLabel] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [aiReport, setAiReport] = useState<AiReport | null>(null);
  const [format, setFormat] = useState<ParseResult["format"] | null>(null);


  const busy = phase !== "idle" && phase !== "done";

  function rejectFiles(message: string) {
    setSelectedFiles([]);
    setSourceLabel("");
    setSummary(null);
    setAiReport(null);
    setTransactions([]);
    setFormat(null);
    setError(message);
    setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  function chooseFiles(fileList?: FileList | File[]) {
    const files = Array.from(fileList ?? []);
    if (files.length < 1) return;
    if (files.length > MAX_STATEMENT_FILES) {
      rejectFiles(`最多选择 ${MAX_STATEMENT_FILES} 个流水文件。`);
      return;
    }
    const oversizedFile = files.find((file) => file.size > MAX_STATEMENT_FILE_BYTES);
    if (oversizedFile) {
      rejectFiles(`${oversizedFile.name} 超过 4MB，请缩小日期范围后重新导出。`);
      return;
    }

    setSelectedFiles(files);
    setSourceLabel(files.length === 1 ? files[0].name : `${files.length} 个文件：${files.map((file) => file.name).join("、")}`);
    setSummary(null);
    setAiReport(null);
    setTransactions([]);
    setFormat(null);
    setError("");
    setPhase("idle");
  }

  async function runAnalysis(input: File[] | ParseResult, label: string) {
    setError("");
    setSummary(null);
    setAiReport(null);

    try {
      setPhase("parsing");
      const result = Array.isArray(input) ? await uploadStatements(input) : input;
      setPhase("calculating");
      const nextSummary = analyzeTransactions(result);
      setSummary(nextSummary);
      setTransactions(result.transactions);
      setFormat(result.format);
      setSourceLabel(label);
      setPhase("ai");

      try {
        setAiReport(await requestAiReport(nextSummary));
      } catch {
        setAiReport(fallbackReport(nextSummary));
      }

      setPhase("done");
      window.setTimeout(
        () => document.getElementById("report")?.scrollIntoView({ behavior: "smooth" }),
        120,
      );
    } catch (reason) {
      setPhase("idle");
      setError(reason instanceof Error ? reason.message : "文件分析失败，请换一份流水重试。");
    }
  }

  async function retryAi() {
    if (!summary) return;
    setPhase("ai");
    setError("");
    try {
      setAiReport(await requestAiReport(summary));
    } catch {
      setError("免费 AI 服务暂时不可用，基础现金流分析不受影响。你可以稍后重试。");
    } finally {
      setPhase("done");
    }
  }

  function resetAnalysis() {
    setSelectedFiles([]);
    setSourceLabel("");
    setSummary(null);
    setTransactions([]);
    setAiReport(null);
    setFormat(null);
    setError("");
    setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main>
      <nav className="nav-shell" aria-label="主导航">
        <a className="brand" href="#top" aria-label="阿坝农商银行内部 AI 财务分析工具首页">
          <span className="brand-mark">阿</span><span>阿坝农商银行</span>
        </a>
        <div className="privacy-chip"><span /> 内部使用 · 无需登录</div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">阿坝农商银行 · 内部使用</p>
          <h1>内部 AI<br />财务分析工具</h1>
          <p className="hero-lead">
            上传银行、支付宝或微信流水，自动整理收支、识别消费结构，
            再由 AI 给出有依据的改善建议。
          </p>
          <div className="trust-row" aria-label="产品特点">
            <span>加密上传解析</span><span>无需注册登录</span><span>原文件不保存</span>
          </div>
        </div>

        <div className="upload-panel">
          <div className="upload-heading">
            <div><span className="step-label">STEP 01</span><h2>{summary ? "本次分析已完成" : "上传 1 至 3 份流水"}</h2></div>
            <span className="secure-badge">隐私模式</span>
          </div>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".csv,.xlsx,.pdf"
            multiple
            onChange={(event) => chooseFiles(event.target.files ?? undefined)}
          />
          <button
            className={`dropzone ${dragging ? "is-dragging" : ""}`}
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              chooseFiles(event.dataTransfer.files);
            }}
          >
            <span className="upload-icon">{summary ? "✓" : "↑"}</span>
            <strong>{sourceLabel || "点击选择，或拖入文件"}</strong>
            <small>支持 CSV、XLSX、带文字层的 PDF · 最多 3 个，每个不超过 4MB</small>
            {selectedFiles.length > 1 && <small>将合并统计，请避免上传日期范围重叠的重复流水</small>}
          </button>

          {busy ? (
            <div className="progress-box" role="status" aria-live="polite">
              <span className="spinner" />
              <div><strong>{PHASE_COPY[phase as keyof typeof PHASE_COPY]}</strong><small>原文件不保存，也不会发送给任何 AI</small></div>
            </div>
          ) : (
            <button
              className="primary-button"
              type="button"
              disabled={selectedFiles.length === 0}
              onClick={() => selectedFiles.length > 0 && runAnalysis(selectedFiles, sourceLabel)}
            >
              {selectedFiles.length > 1 ? "开始合并分析" : selectedFiles.length === 1 ? "开始真实分析" : "选择文件后开始分析"}<span>→</span>
            </button>
          )}

          <button
            className="sample-button"
            type="button"
            disabled={busy}
            onClick={() => runAnalysis(createSampleResult(), "示例：三个月个人流水")}
          >
            没有流水？使用示例数据体验完整 AI 分析
          </button>
          {error && <p className="inline-error" role="alert">{error}</p>}
        </div>
      </section>

      {!summary && (
        <section className="outcome-strip" aria-label="分析结果预览">
          <div className="section-intro">
            <p className="eyebrow">你会得到什么</p>
            <h2>不是一堆图表，<br />而是三件能行动的事。</h2>
          </div>
          <article className="outcome-card card-green">
            <span>01</span><h3>现金流体检</h3><p>收入、流出、结余率和月度趋势，一眼看清。</p>
          </article>
          <article className="outcome-card">
            <span>02</span><h3>消费结构</h3><p>钱花在哪里，哪些支出正在悄悄变多。</p>
          </article>
          <article className="outcome-card card-dark">
            <span>03</span><h3>AI 行动建议</h3><p>只根据你的聚合数据，给出本月优先级。</p>
          </article>
        </section>
      )}

      {summary && aiReport && (
        <FinanceReport
          summary={summary}
          transactions={transactions}
          aiReport={aiReport}
          format={format}
          busy={busy}
          onRetryAi={retryAi}
          onReset={resetAnalysis}
        />
      )}

      <footer>
        <span>阿坝农商银行 · 内部 AI 财务分析工具</span>
        <span>分析仅供财务管理参考，不构成投资、信贷或税务建议</span>
      </footer>
    </main>
  );
}
