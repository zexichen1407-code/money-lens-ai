export type Direction = "income" | "expense";

export type CategoryName =
  | "收入"
  | "餐饮"
  | "交通"
  | "购物"
  | "居住"
  | "娱乐"
  | "医疗"
  | "教育"
  | "金融"
  | "转账"
  | "其他";

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  direction: Direction;
  category: CategoryName;
  source: string;
}

export interface ParseResult {
  transactions: Transaction[];
  ignoredRows: number;
  format: "CSV" | "Excel" | "PDF" | "示例";
}

export interface MonthlyPoint {
  month: string;
  label: string;
  income: number;
  outflow: number;
  net: number;
}

export interface CategoryPoint {
  name: CategoryName;
  amount: number;
  share: number;
}

export interface FinanceSummary {
  periodStart: string;
  periodEnd: string;
  transactionCount: number;
  ignoredRows: number;
  totalIncome: number;
  totalOutflow: number;
  totalConsumption: number;
  transferOutflow: number;
  netCashflow: number;
  savingsRate: number | null;
  score: number | null;
  scoreLabel: string;
  topCategory: CategoryPoint | null;
  largestOutflow: number;
  recurringOutflow: number;
  recurringCount: number;
  latestMonthChange: number | null;
  monthly: MonthlyPoint[];
  categories: CategoryPoint[];
}

const HEADER_ALIASES = {
  date: ["交易时间", "交易日期", "记账日期", "发生日期", "入账日期", "付款时间", "日期", "date", "time"],
  description: ["交易对方", "对方户名", "商户名称", "商品名称", "交易摘要", "摘要", "用途", "备注", "description", "merchant", "memo", "details"],
  amount: ["交易金额", "金额(元)", "金额（元）", "发生额", "金额", "amount"],
  direction: ["收/支", "收支", "交易方向", "借贷标志", "方向", "类型", "direction"],
  income: ["收入金额", "收入", "贷方发生额", "贷方金额", "存入金额", "credit"],
  expense: ["支出金额", "支出", "借方发生额", "借方金额", "取出金额", "debit"],
};

const CATEGORY_RULES: Array<[CategoryName, RegExp]> = [
  ["餐饮", /餐|饭|外卖|美团|饿了么|咖啡|奶茶|星巴克|restaurant|coffee|food|麦当劳|肯德基/i],
  ["交通", /地铁|公交|滴滴|打车|出租|高铁|铁路|航空|机票|加油|停车|充电|transport|taxi|uber/i],
  ["购物", /淘宝|天猫|京东|拼多多|超市|便利店|盒马|山姆|购物|服饰|数码|amazon|shop|mall/i],
  ["居住", /房租|租金|物业|水费|电费|燃气|宽带|家政|装修|mortgage|rent|utility/i],
  ["娱乐", /电影|视频|音乐|游戏|会员|旅游|酒店|演出|健身|娱乐|netflix|steam|cinema/i],
  ["医疗", /医院|药房|诊所|体检|医疗|医保|health|hospital|pharmacy/i],
  ["教育", /课程|学费|培训|书店|教育|考试|course|school|book/i],
  ["金融", /保险|基金|证券|理财|贷款|利息|信用卡|还款|insurance|broker|loan/i],
  ["转账", /转账|转入|转出|红包|亲属卡|transfer/i],
];

const INCOME_WORDS = /收入|入账|存入|转入|工资|薪资|奖金|报销|退款|收益|credit|贷方/i;
const EXPENSE_WORDS = /支出|扣款|付款|消费|转出|借方|debit/i;

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/[\s_\-—:：/\\()（）【】\[\]]/g, "")
    .toLowerCase();
}

function findColumn(headers: unknown[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeHeader);
  const normalizedHeaders = headers.map(normalizeHeader);
  const exactIndex = normalizedHeaders.findIndex((header) => normalizedAliases.includes(header));
  if (exactIndex >= 0) return exactIndex;
  return normalizedHeaders.findIndex((header) =>
    normalizedAliases.some((alias) => alias.length >= 2 && header.includes(alias))
  );
}

function parseMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-" || raw === "--") return null;
  const negativeByBrackets = /^\(.*\)$/.test(raw);
  const cleaned = raw
    .replace(/[，,\s¥￥$€£元人民币RMB]/gi, "")
    .replace(/[()]/g, "");
  const match = cleaned.match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  if (!Number.isFinite(amount)) return null;
  return negativeByBrackets ? -Math.abs(amount) : amount;
}

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && value > 20_000 && value < 80_000) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + value * 86_400_000).toISOString().slice(0, 10);
  }

  const text = String(value ?? "").trim();
  if (!text) return null;
  const normalized = /^20\d{6}$/.test(text)
    ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
    : text
        .replace(/[年/.]/g, "-")
        .replace(/月/g, "-")
        .replace(/日/g, "")
        .replace(/\s+.*/, "");
  const match = normalized.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) return null;
  return date.toISOString().slice(0, 10);
}

function categorize(description: string, direction: Direction): CategoryName {
  if (direction === "income") return "收入";
  for (const [category, pattern] of CATEGORY_RULES) {
    if (pattern.test(description)) return category;
  }
  return "其他";
}

function rowToDescription(row: unknown[], indexes: number[]) {
  const values = indexes
    .filter((index) => index >= 0)
    .map((index) => String(row[index] ?? "").trim())
    .filter(Boolean);
  return [...new Set(values)].join(" · ").slice(0, 120) || "未识别交易";
}

function parseTabularRows(rows: unknown[][], source: string): ParseResult {
  const candidateRows = rows.slice(0, 50);
  let headerIndex = -1;
  let bestScore = 0;

  candidateRows.forEach((row, index) => {
    const hasDate = findColumn(row, HEADER_ALIASES.date) >= 0;
    const hasAmount =
      findColumn(row, HEADER_ALIASES.amount) >= 0 ||
      findColumn(row, HEADER_ALIASES.income) >= 0 ||
      findColumn(row, HEADER_ALIASES.expense) >= 0;
    const hasContext =
      findColumn(row, HEADER_ALIASES.description) >= 0 ||
      findColumn(row, HEADER_ALIASES.direction) >= 0;
    const score = Number(hasDate) * 2 + Number(hasAmount) * 2 + Number(hasContext);
    if (score > bestScore) {
      bestScore = score;
      headerIndex = index;
    }
  });

  if (headerIndex < 0 || bestScore < 4) {
    throw new Error("没有识别到日期和金额列。请优先上传官方导出的 CSV 或 XLSX 流水。");
  }

  const headers = rows[headerIndex];
  const dateIndex = findColumn(headers, HEADER_ALIASES.date);
  const amountIndex = findColumn(headers, HEADER_ALIASES.amount);
  const incomeIndex = findColumn(headers, HEADER_ALIASES.income);
  const expenseIndex = findColumn(headers, HEADER_ALIASES.expense);
  const directionIndex = findColumn(headers, HEADER_ALIASES.direction);
  const descriptionIndexes = HEADER_ALIASES.description
    .map((alias) => findColumn(headers, [alias]))
    .filter((index, position, all) => index >= 0 && all.indexOf(index) === position);
  const amountIndexes = [amountIndex, incomeIndex, expenseIndex].filter((index) => index >= 0);
  if (
    dateIndex < 0 ||
    amountIndexes.length === 0 ||
    amountIndexes.includes(dateIndex) ||
    directionIndex === dateIndex
  ) {
    throw new Error("日期、金额或收支列发生重叠，不能可靠解析。");
  }

  const transactions: Transaction[] = [];
  let ignoredRows = headerIndex;

  rows.slice(headerIndex + 1).forEach((row, rowIndex) => {
    const date = toIsoDate(row[dateIndex]);
    const incomeValue = incomeIndex >= 0 ? parseMoney(row[incomeIndex]) : null;
    const expenseValue = expenseIndex >= 0 ? parseMoney(row[expenseIndex]) : null;
    const amountValue = amountIndex >= 0 ? parseMoney(row[amountIndex]) : null;
    const directionText = directionIndex >= 0 ? String(row[directionIndex] ?? "") : "";
    const description = rowToDescription(row, descriptionIndexes);

    if (/不计收支|中性/.test(directionText)) {
      ignoredRows += 1;
      return;
    }

    let amount: number | null = null;
    let direction: Direction | null = null;

    if (incomeValue !== null && Math.abs(incomeValue) > 0) {
      amount = Math.abs(incomeValue);
      direction = "income";
    } else if (expenseValue !== null && Math.abs(expenseValue) > 0) {
      amount = Math.abs(expenseValue);
      direction = "expense";
    } else if (amountValue !== null && Math.abs(amountValue) > 0) {
      amount = Math.abs(amountValue);
      if (INCOME_WORDS.test(directionText)) direction = "income";
      else if (EXPENSE_WORDS.test(directionText)) direction = "expense";
      else if (amountValue < 0) direction = "expense";
      else if (INCOME_WORDS.test(description)) direction = "income";
      else direction = "expense";
    }

    if (!date || amount === null || !direction) {
      if (row.some((cell) => String(cell ?? "").trim())) ignoredRows += 1;
      return;
    }

    transactions.push({
      id: `${date}-${rowIndex}-${amount}`,
      date,
      description,
      amount,
      direction,
      category: categorize(description, direction),
      source,
    });
  });

  if (transactions.length < 2) {
    throw new Error("有效交易少于 2 笔，暂时无法形成可靠分析。");
  }

  return {
    transactions: transactions.sort((a, b) => a.date.localeCompare(b.date)),
    ignoredRows,
    format: source as ParseResult["format"],
  };
}

function detectDelimiter(text: string) {
  const sample = text.split(/\r?\n/).slice(0, 12).join("\n");
  const candidates = [",", "\t", ";"];
  return candidates.sort((a, b) => sample.split(b).length - sample.split(a).length)[0];
}

function parseDelimitedText(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

async function parseCsv(file: File) {
  const buffer = await file.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buffer);
  const replacementCount = (text.match(/�/g) ?? []).length;
  if (replacementCount > 3) {
    try {
      text = new TextDecoder("gb18030").decode(buffer);
    } catch {
      // Keep the UTF-8 decoding when the browser does not support GB18030.
    }
  }
  return parseTabularRows(parseDelimitedText(text), "CSV");
}

async function parseExcel(file: File) {
  const { readSheet } = await import("read-excel-file/browser");
  const rows = await readSheet(file);
  if (!Array.isArray(rows) || rows.some((row) => !Array.isArray(row))) {
    throw new Error("Excel 工作表结构无法识别，请重新导出后再试。");
  }
  return parseTabularRows(rows as unknown[][], "Excel");
}

interface PositionedPdfText {
  text: string;
  x: number;
  y: number;
  width: number;
}

interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getTextContent(): Promise<{ items: unknown[] }>;
  }>;
}

function positionedPdfText(items: unknown[]): PositionedPdfText[] {
  return items.flatMap((item) => {
    if (typeof item !== "object" || item === null || !("str" in item) || !("transform" in item)) {
      return [];
    }
    const value = item as { str?: unknown; transform?: unknown; width?: unknown };
    if (!Array.isArray(value.transform) || value.transform.length < 6) return [];
    const text = String(value.str ?? "").trim();
    const x = Number(value.transform[4]);
    const y = Number(value.transform[5]);
    const width = Number(value.width ?? 0);
    if (!text || !Number.isFinite(x) || !Number.isFinite(y)) return [];
    return [{ text, x, y, width: Number.isFinite(width) ? width : 0 }];
  });
}

function strictPdfDate(text: string) {
  if (/^20\d{6}$/.test(text)) return toIsoDate(text);
  const matches = text.match(/20\d{2}[年/.\-]\d{1,2}[月/.\-]\d{1,2}日?/g) ?? [];
  if (matches.length !== 1 || text.length > 28) return null;
  return toIsoDate(matches[0]);
}

function strictPdfMoney(text: string) {
  const normalized = text.replace(/[，,]/g, "").trim();
  if (!/^[+\-]?[¥￥]?\s?\d+(?:\.\d{2})$/.test(normalized)) return null;
  return parseMoney(normalized);
}

function usefulPdfDescriptionToken(text: string) {
  const compact = text.replace(/\s+/g, "");
  if (!compact || strictPdfDate(text) || strictPdfMoney(text) !== null) return false;
  if (/^(收入|支出|其他|不计|收支|不计收支|\/)$/.test(compact)) return false;
  if (/^\d{2}:\d{2}:\d{2}$/.test(compact)) return false;
  if (/^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(compact)) return false;
  if (/^\d{12,}$/.test(compact)) return false;
  if (/^[A-Za-z0-9_-]{16,}$/.test(compact)) return false;
  return !HEADER_ALIASES.amount.some((alias) => normalizeHeader(text) === normalizeHeader(alias));
}

async function parsePdfByCoordinates(document: PdfDocumentLike): Promise<ParseResult | null> {
  const transactions: Transaction[] = [];
  let dateCandidateCount = 0;
  let recognizedRowCount = 0;
  let amountColumnCenter: number | null = null;
  let directionColumnCenter: number | null = null;
  let layoutHeaderFound = false;

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = positionedPdfText(content.items);
    const amountHeader = items.find((item) =>
      HEADER_ALIASES.amount.some((alias) => normalizeHeader(item.text) === normalizeHeader(alias))
    );
    const pdfDirectionAliases = HEADER_ALIASES.direction
      .map(normalizeHeader)
      .filter((alias) => alias !== normalizeHeader("类型"));
    const directionHeader = items.find((item) =>
      pdfDirectionAliases.includes(normalizeHeader(item.text))
    ) ?? items.find((item) => {
      const header = normalizeHeader(item.text);
      return pdfDirectionAliases.some((alias) => alias.length >= 2 && header.includes(alias));
    });
    if (amountHeader) {
      amountColumnCenter = amountHeader.x + amountHeader.width / 2;
      layoutHeaderFound = true;
    }
    if (directionHeader) directionColumnCenter = directionHeader.x + directionHeader.width / 2;
    if (amountColumnCenter === null) continue;

    const dateItems = items
      .map((item) => ({ item, date: strictPdfDate(item.text) }))
      .filter((entry): entry is { item: PositionedPdfText; date: string } => Boolean(entry.date))
      .sort((a, b) => b.item.y - a.item.y);
    dateCandidateCount += dateItems.length;

    dateItems.forEach((entry, index) => {
      const amountItem = items
        .map((item) => ({ item, amount: strictPdfMoney(item.text) }))
        .filter((candidate) =>
          candidate.amount !== null &&
          Math.abs(candidate.item.y - entry.item.y) <= 3 &&
          Math.abs(candidate.item.x + candidate.item.width / 2 - amountColumnCenter!) <= 42
        )
        .sort((a, b) =>
          Math.abs(a.item.x + a.item.width / 2 - amountColumnCenter!) -
          Math.abs(b.item.x + b.item.width / 2 - amountColumnCenter!)
        )[0];
      if (!amountItem || amountItem.amount === null) return;

      const nextDateY = dateItems[index + 1]?.item.y;
      const lowerY = nextDateY === undefined ? entry.item.y - 45 : nextDateY + 3;
      const inlineDirection = items.find((item) =>
        Math.abs(item.y - entry.item.y) <= 3 && /^(收入|支出|其他|\/)$/.test(item.text.trim())
      );
      const directionText = directionColumnCenter === null
        ? inlineDirection?.text.trim() ?? ""
        : items
            .filter((item) =>
              item.y <= entry.item.y + 3 &&
              item.y >= lowerY &&
              Math.abs(item.x + item.width / 2 - directionColumnCenter!) <= 32
            )
            .sort((a, b) => b.y - a.y || a.x - b.x)
            .map((item) => item.text)
            .join("")
            .replace(/\s+/g, "");
      const description = [...new Set(
        items
          .filter((item) => item.y <= entry.item.y + 3 && item.y >= lowerY)
          .sort((a, b) => b.y - a.y || a.x - b.x)
          .map((item) => item.text)
          .filter(usefulPdfDescriptionToken),
      )].join(" · ").slice(0, 120) || "PDF 交易";

      if (/不计收支|中性/.test(directionText)) {
        recognizedRowCount += 1;
        return;
      }

      let direction: Direction;
      const explicitAmountSign = amountItem.item.text.replace(/\s+/g, "").match(/^[+\-]/)?.[0];
      if (directionColumnCenter === null && explicitAmountSign) {
        direction = explicitAmountSign === "-" ? "expense" : "income";
      } else if (INCOME_WORDS.test(directionText)) direction = "income";
      else if (EXPENSE_WORDS.test(directionText) || /^(其他|\/)$/.test(directionText)) {
        direction = "expense";
      } else if (directionColumnCenter !== null) {
        return;
      } else {
        direction = amountItem.amount < 0 || !INCOME_WORDS.test(description) ? "expense" : "income";
      }
      recognizedRowCount += 1;
      if (amountItem.amount === 0) return;
      const amount = Math.abs(amountItem.amount);

      transactions.push({
        id: `${entry.date}-pdf-position-${pageNumber}-${index}-${amount}`,
        date: entry.date,
        description,
        amount,
        direction,
        category: categorize(description, direction),
        source: "PDF",
      });
    });
  }

  if (!layoutHeaderFound) return null;
  const coverage = dateCandidateCount === 0 ? 0 : recognizedRowCount / dateCandidateCount;
  if (recognizedRowCount < 2 || coverage < 0.8) {
    throw new Error("PDF 列识别覆盖率不足，不能可靠生成报告。");
  }
  return {
    transactions: transactions.sort((a, b) => a.date.localeCompare(b.date)),
    ignoredRows: Math.max(0, dateCandidateCount - transactions.length),
    format: "PDF",
  };
}

function parsePdfLines(lines: string[]): ParseResult {
  const rows: unknown[][] = lines.map((line) =>
    line.split(/\s{2,}|\t+/).map((cell) => cell.trim()).filter(Boolean)
  );
  try {
    return parseTabularRows(rows, "PDF");
  } catch {
    const transactions: Transaction[] = [];
    let ignoredRows = 0;
    const datePattern = /(20\d{2}[年/.\-]\d{1,2}[月/.\-]\d{1,2}日?)/;
    const moneyPattern = /[+\-]?[¥￥]?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})/g;

    lines.forEach((line, index) => {
      const dateMatch = line.match(datePattern);
      const moneyMatches = line.match(moneyPattern) ?? [];
      if (!dateMatch || moneyMatches.length === 0) {
        if (line.trim()) ignoredRows += 1;
        return;
      }

      const moneyText = moneyMatches[0];
      if (!moneyText) {
        ignoredRows += 1;
        return;
      }

      const date = toIsoDate(dateMatch[1]);
      const rawAmount = parseMoney(moneyText);
      if (!date || rawAmount === null || rawAmount === 0) {
        ignoredRows += 1;
        return;
      }

      const description = line
        .replace(dateMatch[0], "")
        .replace(moneyText, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120) || "PDF 交易";
      const direction: Direction = INCOME_WORDS.test(line)
        ? "income"
        : EXPENSE_WORDS.test(line) || rawAmount < 0
          ? "expense"
          : "expense";

      transactions.push({
        id: `${date}-pdf-${index}`,
        date,
        description,
        amount: Math.abs(rawAmount),
        direction,
        category: categorize(description, direction),
        source: "PDF",
      });
    });

    if (transactions.length < 2) {
      throw new Error("这份 PDF 没有可提取的文本流水。扫描件请先导出为 CSV 或 XLSX。");
    }

    return {
      transactions: transactions.sort((a, b) => a.date.localeCompare(b.date)),
      ignoredRows,
      format: "PDF",
    };
  }
}

async function parsePdf(file: File) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const document = await getDocumentProxy(
    new Uint8Array(await file.arrayBuffer()),
    { isEvalSupported: false, maxImageSize: 16_777_216 } as Parameters<typeof getDocumentProxy>[1],
  );

  if (document.numPages > 100) {
    throw new Error("PDF 超过 100 页。请缩小日期范围后重新导出。");
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const positionedResult = await parsePdfByCoordinates(document as unknown as PdfDocumentLike);
    if (positionedResult) return positionedResult;
    const { text } = await Promise.race([
      extractText(document, { mergePages: false }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("PDF 解析超时，请缩小文件后重试。")), 20_000);
      }),
    ]);
    const lines = text.flatMap((page) => page.split(/\r?\n/));
    return parsePdfLines(lines);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if ("destroy" in document && typeof document.destroy === "function") {
      await document.destroy();
    }
  }
}

function validateParseResult(result: ParseResult) {
  const { transactions } = result;
  if (transactions.length < 2) throw new Error("有效交易少于 2 笔，暂时无法形成可靠分析。");
  if (transactions.some((item) => !Number.isFinite(item.amount) || item.amount <= 0)) {
    throw new Error("流水中存在无效金额，已停止生成报告。");
  }

  if (transactions.length >= 10) {
    const frequencies = new Map<number, number>();
    transactions.forEach((item) => {
      frequencies.set(item.amount, (frequencies.get(item.amount) ?? 0) + 1);
    });
    const [dominantAmount, dominantCount] = [...frequencies.entries()]
      .sort((a, b) => b[1] - a[1])[0];
    const years = new Set(transactions.map((item) => Number(item.date.slice(0, 4))));
    if (dominantCount / transactions.length >= 0.8 && years.has(dominantAmount)) {
      throw new Error("检测到年份被误识别为金额，已停止生成错误报告。");
    }
  }
  return result;
}

export function normalizeAiTransactions(input: unknown): ParseResult {
  const root = typeof input === "object" && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
  const rows = Array.isArray(root?.transactions) ? root.transactions : [];
  const transactions = rows.flatMap((value, index): Transaction[] => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const date = toIsoDate(row.date);
    const amount = parseMoney(row.amount);
    const description = typeof row.description === "string"
      ? row.description.trim().slice(0, 120)
      : "AI 识别交易";
    const directionText = String(row.direction ?? "");
    const direction: Direction = /income|收入|入账|贷方/i.test(directionText)
      ? "income"
      : "expense";
    if (!date || amount === null || amount === 0) return [];
    return [{
      id: `${date}-pdf-ai-${index}-${Math.abs(amount)}`,
      date,
      description: description || "AI 识别交易",
      amount: Math.abs(amount),
      direction,
      category: categorize(description, direction),
      source: "PDF AI",
    }];
  });
  return validateParseResult({
    transactions: transactions.sort((a, b) => a.date.localeCompare(b.date)),
    ignoredRows: 0,
    format: "PDF",
  });
}
export async function parseStatement(file: File): Promise<ParseResult> {
  if (file.size > 4 * 1024 * 1024) {
    throw new Error("文件超过 4MB。请缩小日期范围后重新导出。");
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") return validateParseResult(await parseCsv(file));
  if (extension === "xlsx") return validateParseResult(await parseExcel(file));
  if (extension === "pdf") return validateParseResult(await parsePdf(file));
  throw new Error("暂不支持该格式。请上传 CSV、XLSX 或文本型 PDF。");
}

function monthLabel(month: string) {
  const [, value] = month.split("-");
  return `${Number(value)}月`;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function recurringMetrics(transactions: Transaction[]) {
  const merchants = new Map<string, { months: Set<string>; total: number }>();
  transactions
    .filter((transaction) => transaction.direction === "expense" && transaction.category !== "转账")
    .forEach((transaction) => {
      const key = transaction.description
        .toLowerCase()
        .replace(/\d+/g, "")
        .replace(/[\s·\-_]/g, "")
        .slice(0, 36);
      if (!key || key === "未识别交易") return;
      const entry = merchants.get(key) ?? { months: new Set<string>(), total: 0 };
      entry.months.add(transaction.date.slice(0, 7));
      entry.total += transaction.amount;
      merchants.set(key, entry);
    });

  const recurring = [...merchants.values()].filter((entry) => entry.months.size >= 2);
  return {
    recurringCount: recurring.length,
    recurringOutflow: roundMoney(recurring.reduce((sum, entry) => sum + entry.total, 0)),
  };
}

export function analyzeTransactions(result: ParseResult): FinanceSummary {
  const { transactions } = result;
  const totalIncome = transactions
    .filter((item) => item.direction === "income")
    .reduce((sum, item) => sum + item.amount, 0);
  const expenseTransactions = transactions.filter((item) => item.direction === "expense");
  const totalOutflow = expenseTransactions.reduce((sum, item) => sum + item.amount, 0);
  const transferOutflow = expenseTransactions
    .filter((item) => item.category === "转账")
    .reduce((sum, item) => sum + item.amount, 0);
  const totalConsumption = totalOutflow - transferOutflow;
  const netCashflow = totalIncome - totalOutflow;
  const savingsRate = totalIncome > 0 ? netCashflow / totalIncome : null;

  const monthlyMap = new Map<string, { income: number; outflow: number }>();
  transactions.forEach((transaction) => {
    const month = transaction.date.slice(0, 7);
    const point = monthlyMap.get(month) ?? { income: 0, outflow: 0 };
    if (transaction.direction === "income") point.income += transaction.amount;
    else point.outflow += transaction.amount;
    monthlyMap.set(month, point);
  });

  const monthly = [...monthlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({
      month,
      label: monthLabel(month),
      income: roundMoney(value.income),
      outflow: roundMoney(value.outflow),
      net: roundMoney(value.income - value.outflow),
    }));

  const categoryMap = new Map<CategoryName, number>();
  expenseTransactions.forEach((transaction) => {
    categoryMap.set(
      transaction.category,
      (categoryMap.get(transaction.category) ?? 0) + transaction.amount,
    );
  });
  const categories = [...categoryMap.entries()]
    .map(([name, amount]) => ({
      name,
      amount: roundMoney(amount),
      share: totalOutflow > 0 ? amount / totalOutflow : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
  const topCategory = categories.find((category) => category.name !== "转账") ?? categories[0] ?? null;

  const previous = monthly.at(-2);
  const latest = monthly.at(-1);
  const latestMonthChange =
    previous && latest && previous.outflow > 0
      ? (latest.outflow - previous.outflow) / previous.outflow
      : null;

  let score: number | null = null;
  if (savingsRate !== null) {
    score =
      savingsRate >= 0.35 ? 88 :
      savingsRate >= 0.2 ? 78 :
      savingsRate >= 0.1 ? 68 :
      savingsRate >= 0 ? 56 : 38;
    if (latestMonthChange !== null && latestMonthChange > 0.25) score -= 5;
    if (latestMonthChange !== null && latestMonthChange < -0.15) score += 3;
    score = Math.max(0, Math.min(100, score));
  }

  const scoreLabel =
    score === null ? "数据不足" :
    score >= 80 ? "现金流稳健" :
    score >= 65 ? "基本健康" :
    score >= 50 ? "需要关注" : "现金流承压";

  return {
    periodStart: transactions[0].date,
    periodEnd: transactions.at(-1)!.date,
    transactionCount: transactions.length,
    ignoredRows: result.ignoredRows,
    totalIncome: roundMoney(totalIncome),
    totalOutflow: roundMoney(totalOutflow),
    totalConsumption: roundMoney(totalConsumption),
    transferOutflow: roundMoney(transferOutflow),
    netCashflow: roundMoney(netCashflow),
    savingsRate,
    score,
    scoreLabel,
    topCategory,
    largestOutflow: roundMoney(
      Math.max(0, ...expenseTransactions.map((transaction) => transaction.amount)),
    ),
    ...recurringMetrics(transactions),
    latestMonthChange,
    monthly,
    categories,
  };
}

export function buildAiPayload(summary: FinanceSummary) {
  return {
    period: { start: summary.periodStart, end: summary.periodEnd },
    sample: {
      transactionCount: summary.transactionCount,
      ignoredRows: summary.ignoredRows,
    },
    cashflow: {
      income: summary.totalIncome,
      outflow: summary.totalOutflow,
      consumptionExcludingTransfers: summary.totalConsumption,
      transferOutflow: summary.transferOutflow,
      net: summary.netCashflow,
      savingsRate: summary.savingsRate,
      cashflowScore: summary.score,
    },
    trend: summary.monthly,
    categoryMix: summary.categories.map(({ name, amount, share }) => ({ name, amount, share })),
    signals: {
      latestMonthOutflowChange: summary.latestMonthChange,
      largestSingleOutflow: summary.largestOutflow,
      recurringMerchantCount: summary.recurringCount,
      recurringOutflow: summary.recurringOutflow,
    },
  };
}

function monthDate(offset: number, day: number) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offset, day);
  return date.toISOString().slice(0, 10);
}

export function createSampleResult(): ParseResult {
  const templates: Array<[number, string, number, Direction]> = [
    [1, "薪资入账", 26000, "income"],
    [2, "房租", 6800, "expense"],
    [4, "盒马鲜生", 486, "expense"],
    [6, "地铁出行", 92, "expense"],
    [8, "美团外卖", 218, "expense"],
    [10, "健身会员", 399, "expense"],
    [12, "淘宝购物", 760, "expense"],
    [15, "星巴克", 126, "expense"],
    [18, "滴滴出行", 184, "expense"],
    [21, "朋友转账", 1200, "expense"],
    [24, "电影院", 136, "expense"],
    [27, "药房", 88, "expense"],
  ];

  const transactions: Transaction[] = [];
  [-2, -1, 0].forEach((monthOffset) => {
    templates.forEach(([day, description, baseAmount, direction], index) => {
      const variation = direction === "income" ? 0 : monthOffset * 18 + (index % 3) * 12;
      const amount = Math.max(20, baseAmount + variation);
      transactions.push({
        id: `sample-${monthOffset}-${index}`,
        date: monthDate(monthOffset, day),
        description,
        amount,
        direction,
        category: categorize(description, direction),
        source: "示例",
      });
    });
  });

  return {
    transactions: transactions.sort((a, b) => a.date.localeCompare(b.date)),
    ignoredRows: 0,
    format: "示例",
  };
}

