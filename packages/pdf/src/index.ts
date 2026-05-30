import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage } from "pdf-lib";
import { ReportPayload } from "@vericount/shared";

const BRAND_BLUE = rgb(0.059, 0.298, 0.506);
const GRAY_BG    = rgb(0.95, 0.95, 0.95);
const TEXT_DARK  = rgb(0.1, 0.1, 0.1);
const TEXT_MED   = rgb(0.4, 0.4, 0.4);
const TEXT_LIGHT = rgb(0.7, 0.7, 0.7);

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const MIN_Y = 60; // footer zone — add new page if y drops below this

// ─── Pager: tracks current page + y position ────────────

class Pager {
  doc: PDFDocument;
  bold: PDFFont;
  regular: PDFFont;
  page: PDFPage;
  y: number;
  pageNum: number;
  totalPages: number; // filled in at end via placeholder

  constructor(doc: PDFDocument, bold: PDFFont, regular: PDFFont) {
    this.doc = doc;
    this.bold = bold;
    this.regular = regular;
    this.pageNum = 1;
    this.totalPages = 1;
    this.page = doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H;
  }

  /** Ensure at least `needed` pts of vertical space; add new page if not. */
  need(needed: number): void {
    if (this.y - needed < MIN_Y) {
      this.addPage();
    }
  }

  addPage(): void {
    this.pageNum++;
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - 30;
    // Continuation sub-header
    this.page.drawText("VERICOUNT — continued", {
      x: MARGIN, y: this.y, size: 8, font: this.regular, color: TEXT_LIGHT,
    });
    this.y -= 20;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.5,
      color: rgb(0.88, 0.88, 0.88),
    });
    this.y -= 14;
  }

  drawFooter(pageIndex: number): void {
    const footerText = `Vericount · Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · Page ${pageIndex + 1}`;
    this.doc.getPages()[pageIndex].drawText(footerText, {
      x: MARGIN, y: 18, size: 7.5, font: this.regular, color: TEXT_LIGHT,
    });
  }
}

// ─── Main builder ────────────────────────────────────────

export async function buildReportPDF(payload: ReportPayload): Promise<Uint8Array> {
  const doc  = await PDFDocument.create();
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const pg = new Pager(doc, bold, regular);

  // ── Header band (page 1 only) ──────────────────────────
  pg.page.drawRectangle({ x: 0, y: PAGE_H - 80, width: PAGE_W, height: 80, color: BRAND_BLUE });
  pg.page.drawText("VERICOUNT", { x: MARGIN, y: PAGE_H - 32, size: 22, font: bold, color: rgb(1,1,1) });
  pg.page.drawText("Monthly Financial Report", { x: MARGIN, y: PAGE_H - 52, size: 10, font: regular, color: rgb(0.8,0.85,0.92) });
  pg.page.drawText(payload.period, { x: PAGE_W - 150, y: PAGE_H - 32, size: 14, font: bold, color: rgb(1,1,1) });
  pg.y = PAGE_H - 100;

  // ── Business name ──────────────────────────────────────
  pg.page.drawText(payload.businessName, { x: MARGIN, y: pg.y, size: 16, font: bold, color: BRAND_BLUE });
  pg.y -= 18;
  pg.page.drawText(`Prepared for: ${payload.clientName}`, { x: MARGIN, y: pg.y, size: 9, font: regular, color: TEXT_MED });
  pg.y -= 8;
  pg.page.drawLine({ start: { x: MARGIN, y: pg.y }, end: { x: PAGE_W - MARGIN, y: pg.y }, thickness: 0.75, color: rgb(0.88,0.88,0.88) });
  pg.y -= 22;

  // ── P&L ───────────────────────────────────────────────
  drawSectionHeader(pg, "Profit & Loss Summary");
  drawTableHeader(pg);

  const pnl = payload.financialData.pnl;
  const totalRev = pnl.revenue.reduce((s, r) => s + r.amount, 0);
  const totalExp = pnl.expenses.reduce((s, r) => s + r.amount, 0);

  drawSubLabel(pg, "Revenue");
  for (const row of pnl.revenue) {
    pg.need(14);
    drawTableRow(pg, row.account, row.amount);
  }
  drawTotalRow(pg, "Total Revenue", totalRev);
  pg.y -= 6;

  drawSubLabel(pg, "Expenses");
  for (const row of pnl.expenses) {
    pg.need(14);
    drawTableRow(pg, row.account, row.amount);
  }
  drawTotalRow(pg, "Total Expenses", totalExp);
  pg.y -= 6;

  // Net income highlight
  pg.need(30);
  const netColor = pnl.netIncome >= 0 ? rgb(0.1, 0.55, 0.2) : rgb(0.75, 0.15, 0.15);
  pg.page.drawRectangle({ x: MARGIN, y: pg.y - 20, width: CONTENT_W, height: 24, color: GRAY_BG });
  pg.page.drawText("Net Income", { x: MARGIN + 10, y: pg.y - 12, size: 10, font: bold, color: TEXT_DARK });
  const netStr = fmtAmt(pnl.netIncome);
  pg.page.drawText(netStr, { x: PAGE_W - MARGIN - bold.widthOfTextAtSize(netStr, 10), y: pg.y - 12, size: 10, font: bold, color: netColor });
  pg.y -= 36;

  // ── Balance sheet ──────────────────────────────────────
  pg.need(80);
  const bs = payload.financialData.balanceSheet;
  drawSectionHeader(pg, "Balance Sheet Highlights");
  drawKVRow(pg, "Total Assets",      fmtAmt(bs.totalAssets));
  drawKVRow(pg, "Total Liabilities", fmtAmt(bs.totalLiabilities));
  drawKVRow(pg, "Net Equity",        fmtAmt(bs.totalAssets - bs.totalLiabilities));
  pg.y -= 18;

  // ── Narrative ──────────────────────────────────────────
  pg.need(60);
  drawSectionHeader(pg, "Bookkeeper's Summary");
  drawWrappedText(pg, payload.narrative, 9.5);

  // ── Footers on every page ──────────────────────────────
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    pg.drawFooter(i);
  }

  return doc.save();
}

// ─── Drawing helpers (all mutate Pager) ─────────────────

function drawSectionHeader(pg: Pager, title: string): void {
  pg.need(24);
  pg.page.drawText(title, { x: MARGIN, y: pg.y, size: 12, font: pg.bold, color: BRAND_BLUE });
  pg.page.drawLine({ start: { x: MARGIN, y: pg.y - 4 }, end: { x: PAGE_W - MARGIN, y: pg.y - 4 }, thickness: 1.2, color: BRAND_BLUE });
  pg.y -= 20;
}

function drawTableHeader(pg: Pager): void {
  pg.need(22);
  pg.page.drawRectangle({ x: MARGIN, y: pg.y - 14, width: CONTENT_W, height: 18, color: rgb(0.92, 0.93, 0.95) });
  pg.page.drawText("Account", { x: MARGIN + 10, y: pg.y - 8, size: 8, font: pg.bold, color: TEXT_DARK });
  pg.page.drawText("Amount",  { x: PAGE_W - 100, y: pg.y - 8, size: 8, font: pg.bold, color: TEXT_DARK });
  pg.y -= 20;
}

function drawSubLabel(pg: Pager, label: string): void {
  pg.need(15);
  pg.page.drawText(label, { x: MARGIN + 10, y: pg.y, size: 8, font: pg.bold, color: TEXT_MED });
  pg.y -= 13;
}

function drawTableRow(pg: Pager, account: string, amount: number): void {
  const truncated = account.length > 52 ? account.slice(0, 50) + "…" : account;
  pg.page.drawText(truncated, { x: MARGIN + 20, y: pg.y, size: 8.5, font: pg.regular, color: TEXT_DARK });
  const amtStr = fmtAmt(amount);
  pg.page.drawText(amtStr, { x: PAGE_W - MARGIN - pg.regular.widthOfTextAtSize(amtStr, 8.5), y: pg.y, size: 8.5, font: pg.regular, color: TEXT_DARK });
  pg.y -= 12;
}

function drawTotalRow(pg: Pager, label: string, amount: number): void {
  pg.need(20);
  pg.page.drawLine({ start: { x: MARGIN, y: pg.y + 2 }, end: { x: PAGE_W - MARGIN, y: pg.y + 2 }, thickness: 0.4, color: rgb(0.82,0.82,0.82) });
  pg.y -= 8;
  pg.page.drawText(label, { x: MARGIN + 20, y: pg.y, size: 8.5, font: pg.bold, color: TEXT_DARK });
  const amtStr = fmtAmt(amount);
  pg.page.drawText(amtStr, { x: PAGE_W - MARGIN - pg.bold.widthOfTextAtSize(amtStr, 8.5), y: pg.y, size: 8.5, font: pg.bold, color: TEXT_DARK });
  pg.y -= 14;
}

function drawKVRow(pg: Pager, key: string, value: string): void {
  pg.need(15);
  pg.page.drawText(key,   { x: MARGIN + 10, y: pg.y, size: 8.5, font: pg.regular, color: TEXT_DARK });
  pg.page.drawText(value, { x: PAGE_W - MARGIN - pg.bold.widthOfTextAtSize(value, 8.5), y: pg.y, size: 8.5, font: pg.bold, color: TEXT_DARK });
  pg.y -= 13;
}

function drawWrappedText(pg: Pager, text: string, size: number): void {
  const lineH = size + 4;

  // Split on paragraph breaks (\n\n or more), then word-wrap each paragraph.
  // This preserves the paragraph structure from AI-generated narratives.
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (let pi = 0; pi < paragraphs.length; pi++) {
    // Add extra gap between paragraphs (but not before the first one)
    if (pi > 0) {
      pg.y -= 7;
    }

    const words = paragraphs[pi].split(" ");
    let line = "";

    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (pg.regular.widthOfTextAtSize(test, size) > CONTENT_W && line) {
        pg.need(lineH + 4);
        pg.page.drawText(line, { x: MARGIN, y: pg.y, size, font: pg.regular, color: TEXT_DARK });
        pg.y -= lineH;
        line = word;
      } else {
        line = test;
      }
    }
    if (line) {
      pg.need(lineH + 4);
      pg.page.drawText(line, { x: MARGIN, y: pg.y, size, font: pg.regular, color: TEXT_DARK });
      pg.y -= lineH;
    }
  }
}

function fmtAmt(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `($${abs})` : `$${abs}`;
}
