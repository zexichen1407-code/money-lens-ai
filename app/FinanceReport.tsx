"use client";

import type { FinanceSummary, Transaction } from "../lib/finance";
import type { AiReport } from "../lib/local-ai";

interface FinanceReportProps {
  summary: FinanceSummary;
  transactions: Transaction[];
  aiReport: AiReport;
  format: string | null;
  busy: boolean;
  onRetryAi: () => void;
  onReset: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  餐饮: "#d86b45",
  交通: "#4f82be",
  购物: "#8b68b8",
  居住: "#3c816c",
  娱乐: "#d4973c",
  医疗: "#d35d75",
  教育: "#6780c5",
  金融: "#61736b",
  转账: "#9aa39d",
  其他: "#b4a17f",
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "" : "-"}${Math.abs(value * 100).toFixed(1)}%`;
}

export default function FinanceReport({
  summary,
  transactions,
  aiReport,
  format,
  busy,
  onRetryAi,
  onReset,
}: FinanceReportProps) {
  const maxMonthly = Math.max(
    1,
    ...summary.monthly.flatMap((point) => [point.income, point.outflow]),
  );

  return (
    <section className="report-shell" id="report">
      <header className="report-header">
        <div>
          <p className="eyebrow">FINANCIAL CHECKUP</p>
          <h2>你的现金流体检</h2>
          <p>{format} · {summary.transactionCount} 笔交易 · {summary.periodStart} 至 {summary.periodEnd}</p>
        </div>
        <div className="report-actions">
          <button type="button" onClick={() => window.print()}>打印 / 存为 PDF</button>
          <button type="button" onClick={onReset}>清除本次数据</button>
        </div>
      </header>

      <div className="score-card">
        <div className="score-orbit"><strong>{summary.score ?? "—"}</strong><span>现金流分</span></div>
        <div>
          <span className="status-pill">{summary.scoreLabel}</span>
          <h3>{summary.netCashflow >= 0 ? "本期现金流有结余。" : "本期现金流出现缺口。"}</h3>
          <p>评分只依据这份流水中的收支、结余率和短期趋势，不等于资产水平、偿债能力或信用评分。</p>
        </div>
      </div>

      <div className="metric-grid">
        <article><span>总收入</span><strong>{formatMoney(summary.totalIncome)}</strong><small>上传区间内识别</small></article>
        <article><span>总流出</span><strong>{formatMoney(summary.totalOutflow)}</strong><small>含转账 {formatMoney(summary.transferOutflow)}</small></article>
        <article><span>净现金流</span><strong className={summary.netCashflow >= 0 ? "positive" : "negative"}>{formatMoney(summary.netCashflow)}</strong><small>收入减全部流出</small></article>
        <article><span>结余率</span><strong>{formatPercent(summary.savingsRate)}</strong><small>净现金流 / 收入</small></article>
      </div>

      <div className="insight-grid">
        <article className="chart-card">
          <div className="card-title">
            <div><span>MONTHLY FLOW</span><h3>月度收支趋势</h3></div>
            <div className="legend"><i className="income-dot" />收入 <i className="expense-dot" />流出</div>
          </div>
          <div className="bar-chart" aria-label="月度收支柱状图">
            {summary.monthly.map((point) => (
              <div className="bar-group" key={point.month}>
                <div className="bars">
                  <span className="bar-income" style={{ height: `${Math.max(4, point.income / maxMonthly * 100)}%` }} title={`收入 ${formatMoney(point.income)}`} />
                  <span className="bar-expense" style={{ height: `${Math.max(4, point.outflow / maxMonthly * 100)}%` }} title={`流出 ${formatMoney(point.outflow)}`} />
                </div>
                <strong>{point.label}</strong>
                <small className={point.net >= 0 ? "positive" : "negative"}>
                  {point.net >= 0 ? "+" : ""}{formatMoney(point.net)}
                </small>
              </div>
            ))}
          </div>
        </article>

        <article className="chart-card">
          <div className="card-title"><div><span>SPENDING MIX</span><h3>流出去向</h3></div><small>按全部流出计算</small></div>
          <div className="category-list">
            {summary.categories.slice(0, 6).map((category) => (
              <div className="category-row" key={category.name}>
                <div className="category-meta">
                  <span><i style={{ background: CATEGORY_COLORS[category.name] ?? "#9aa39d" }} />{category.name}</span>
                  <strong>{formatMoney(category.amount)}</strong>
                </div>
                <div className="category-track">
                  <span style={{ width: `${Math.max(2, category.share * 100)}%`, background: CATEGORY_COLORS[category.name] ?? "#9aa39d" }} />
                </div>
                <small>{formatPercent(category.share)}</small>
              </div>
            ))}
          </div>
        </article>
      </div>

      <article className="ai-card">
        <div className="ai-card-head">
          <div><span className="ai-mark">AI</span><div><h3>钱镜解读</h3><p>浏览器本地开源模型 · 无需登录</p></div></div>
          <span className={aiReport.aiPowered ? "live-badge" : "fallback-badge"}>
            {aiReport.aiPowered ? "本地 Qwen AI 已生成" : "本地规则版"}
          </span>
        </div>
        <blockquote>{aiReport.summary}</blockquote>
        <div className="ai-columns">
          <div>
            <h4>值得注意</h4>
            <ul>{aiReport.insights.map((item, index) => <li key={index}><span>{String(index + 1).padStart(2, "0")}</span>{item}</li>)}</ul>
          </div>
          <div>
            <h4>本月先做</h4>
            <ul>{aiReport.actions.map((item, index) => <li key={index}><span>→</span>{item}</li>)}</ul>
          </div>
        </div>
        {!aiReport.aiPowered && (
          <div className="ai-retry">
            <p>本地 AI 未能完成生成，当前文字由本地规则生成；收支数字和图表仍来自真实流水。</p>
            <button type="button" disabled={busy} onClick={onRetryAi}>重新运行本地 AI</button>
          </div>
        )}
      </article>

      <div className="detail-grid">
        <article className="transaction-card">
          <div className="card-title"><div><span>LOCAL DETAIL</span><h3>最近识别的交易</h3></div><small>仅在本页内存中显示</small></div>
          <div className="transaction-table">
            {transactions.slice(-8).reverse().map((transaction) => (
              <div className="transaction-row" key={transaction.id}>
                <span className="transaction-date">{transaction.date.slice(5)}</span>
                <div><strong>{transaction.description}</strong><small>{transaction.category}</small></div>
                <strong className={transaction.direction === "income" ? "positive" : ""}>
                  {transaction.direction === "income" ? "+" : "-"}{formatMoney(transaction.amount)}
                </strong>
              </div>
            ))}
          </div>
        </article>

        <aside className="data-note">
          <span className="lock-symbol">⌁</span>
          <h3>这次分析没有保存原文件</h3>
          <p>CSV、XLSX、PDF 和 AI 模型都在你的浏览器中运行。原文件、商户明细和聚合指标均不会发送到本站服务器或第三方 AI 接口。</p>
          <dl>
            <div><dt>成功识别</dt><dd>{summary.transactionCount} 笔</dd></div>
            <div><dt>未采用行</dt><dd>{summary.ignoredRows} 行</dd></div>
            <div><dt>币种口径</dt><dd>按人民币展示，不做汇率换算</dd></div>
          </dl>
        </aside>
      </div>
    </section>
  );
}

