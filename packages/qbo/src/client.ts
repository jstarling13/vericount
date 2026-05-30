import { QBOFinancialData } from "@vericount/shared";

const QBO_BASE = "https://quickbooks.api.intuit.com";
const QBO_SANDBOX_BASE = "https://sandbox-quickbooks.api.intuit.com";

function baseUrl(): string {
  return process.env.QBO_ENVIRONMENT === "production" ? QBO_BASE : QBO_SANDBOX_BASE;
}

async function qboFetch(
  path: string,
  accessToken: string,
  realmId: string,
  options: RequestInit = {}
): Promise<unknown> {
  const url = `${baseUrl()}/v3/company/${realmId}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`QBO API error ${res.status}: ${body}`);
  }

  return res.json();
}

// ─── Reports ─────────────────────────────────────────────

export async function getProfitAndLoss(
  accessToken: string,
  realmId: string,
  startDate: string, // "YYYY-MM-DD"
  endDate: string
): Promise<unknown> {
  return qboFetch(
    `/reports/ProfitAndLoss?start_date=${startDate}&end_date=${endDate}&summarize_column_by=Total`,
    accessToken,
    realmId
  );
}

export async function getBalanceSheet(
  accessToken: string,
  realmId: string,
  asOfDate: string // "YYYY-MM-DD"
): Promise<unknown> {
  return qboFetch(
    `/reports/BalanceSheet?as_of=${asOfDate}&summarize_column_by=Total`,
    accessToken,
    realmId
  );
}

// ─── Parse QBO report rows into flat arrays ───────────────

function extractRows(
  section: Record<string, unknown>,
  label: string
): { account: string; amount: number }[] {
  const rows: { account: string; amount: number }[] = [];

  // QBO reports use a nested structure: Rows.Row[] where each Row can be a
  // Section (containing more Rows.Row[]) or a Data leaf with ColData columns.
  // Arrays must be unwrapped before property-access since array objects have
  // no .Rows / .Row / .ColData properties of their own.
  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;

    // Unwrap arrays — walk each element individually
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    const n = node as Record<string, unknown>;

    // Leaf: data row with account name + amount
    if (n.type === "Data" && Array.isArray(n.ColData)) {
      const cols = n.ColData as Array<{ value?: string }>;
      const name = cols[0]?.value ?? "";
      const rawAmt = cols[1]?.value ?? "0";
      if (name && name !== label) {
        rows.push({ account: name, amount: parseFloat(rawAmt) || 0 });
      }
    }

    // Recurse into nested Rows and Row structures
    if (n.Rows) walk(n.Rows);
    if (n.Row) walk(n.Row);
  }

  walk(section);
  return rows;
}

export function parseFinancialData(
  pnlRaw: unknown,
  balanceSheetRaw: unknown,
  period: string
): QBOFinancialData {
  const pnl = pnlRaw as Record<string, unknown>;
  const bs = balanceSheetRaw as Record<string, unknown>;

  // P&L parsing
  const rows = (pnl?.Rows as Record<string, unknown>) ?? {};
  const revenue = extractRows(rows, "Income");
  const expenses = extractRows(rows, "Expenses");
  const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
  const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);

  // Balance sheet parsing
  const bsRows = (bs?.Rows as Record<string, unknown>) ?? {};
  const assets = extractRows(bsRows, "Assets");
  const liabilities = extractRows(bsRows, "Liabilities");
  const equity = extractRows(bsRows, "Equity");

  return {
    pnl: {
      revenue,
      expenses,
      netIncome: totalRevenue - totalExpenses,
      period,
    },
    balanceSheet: {
      assets,
      liabilities,
      equity,
      totalAssets: assets.reduce((s, r) => s + r.amount, 0),
      totalLiabilities: liabilities.reduce((s, r) => s + r.amount, 0),
      period,
    },
  };
}

// ─── Transactions ─────────────────────────────────────────

export async function createExpense(
  accessToken: string,
  realmId: string,
  payload: {
    date: string;
    amount: number;
    description: string;
    accountRef: string; // QBO account ID
    vendorName?: string;
  }
): Promise<unknown> {
  const body = {
    TxnDate: payload.date,
    TotalAmt: payload.amount,
    PrivateNote: payload.description,
    AccountRef: { value: payload.accountRef },
    ...(payload.vendorName
      ? { EntityRef: { name: payload.vendorName, type: "Vendor" } }
      : {}),
  };
  return qboFetch("/purchase", accessToken, realmId, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function createDeposit(
  accessToken: string,
  realmId: string,
  payload: {
    date: string;
    amount: number;
    description: string;
    depositAccountRef: string;
  }
): Promise<unknown> {
  const body = {
    TxnDate: payload.date,
    TotalAmt: payload.amount,
    PrivateNote: payload.description,
    DepositToAccountRef: { value: payload.depositAccountRef },
  };
  return qboFetch("/deposit", accessToken, realmId, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ─── Accounts lookup (for categorization) ────────────────

export async function getChartOfAccounts(
  accessToken: string,
  realmId: string
): Promise<Array<{ id: string; name: string; type: string; subType: string }>> {
  const result = (await qboFetch(
    `/query?query=SELECT * FROM Account WHERE Active = true MAXRESULTS 200`,
    accessToken,
    realmId
  )) as { QueryResponse?: { Account?: Array<{ Id: string; Name: string; AccountType: string; AccountSubType: string }> } };

  return (result?.QueryResponse?.Account ?? []).map((a) => ({
    id: a.Id,
    name: a.Name,
    type: a.AccountType,
    subType: a.AccountSubType,
  }));
}
