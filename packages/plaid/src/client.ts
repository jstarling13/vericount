import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
  Transaction,
  AccountBase,
} from "plaid";

// Module-level singleton — credentials are fixed at startup; reuse HTTP connections.
let _plaid: PlaidApi | null = null;

function createPlaidClient(): PlaidApi {
  if (_plaid) return _plaid;
  const env = process.env.PLAID_ENV ?? "sandbox";
  const config = new Configuration({
    basePath:
      env === "production"
        ? PlaidEnvironments.production
        : env === "development"
        ? PlaidEnvironments.development
        : PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
        "PLAID-SECRET": process.env.PLAID_SECRET!,
      },
    },
  });
  _plaid = new PlaidApi(config);
  return _plaid;
}

// ─── Link token (used by the portal to open Plaid Link) ──

export async function createLinkToken(
  clientUserId: string,
  clientName: string
): Promise<string> {
  const plaid = createPlaidClient();
  const response = await plaid.linkTokenCreate({
    user: { client_user_id: clientUserId },
    client_name: "Vericount",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
    webhook: process.env.PLAID_WEBHOOK_URL,
  });
  return response.data.link_token;
}

// ─── Update-mode link token (re-authentication) ──────────

export async function createUpdateLinkToken(
  accessToken: string,
  clientUserId: string
): Promise<string> {
  const plaid = createPlaidClient();
  const response = await plaid.linkTokenCreate({
    user: { client_user_id: clientUserId },
    client_name: "Vericount",
    access_token: accessToken,
    country_codes: [CountryCode.Us],
    language: "en",
  });
  return response.data.link_token;
}

// ─── Exchange public token for access token ───────────────

export async function exchangePublicToken(publicToken: string): Promise<{
  accessToken: string;
  itemId: string;
}> {
  const plaid = createPlaidClient();
  const response = await plaid.itemPublicTokenExchange({
    public_token: publicToken,
  });
  return {
    accessToken: response.data.access_token,
    itemId: response.data.item_id,
  };
}

// ─── Get accounts for an item ─────────────────────────────

export async function getAccounts(
  accessToken: string
): Promise<AccountBase[]> {
  const plaid = createPlaidClient();
  const response = await plaid.accountsGet({ access_token: accessToken });
  return response.data.accounts;
}

// ─── Pull transactions ────────────────────────────────────

export interface PlaidTransaction {
  id: string;
  accountId: string;
  date: string;
  amount: number;      // Plaid: positive = debit from account
  name: string;
  merchantName: string | null;
  category: string[];
  pending: boolean;
}

export async function getTransactions(
  accessToken: string,
  startDate: string, // "YYYY-MM-DD"
  endDate: string,
  accountIds?: string[]
): Promise<PlaidTransaction[]> {
  const plaid = createPlaidClient();
  const allTransactions: Transaction[] = [];
  let hasMore = true;
  let offset = 0;

  while (hasMore) {
    const response = await plaid.transactionsGet({
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
      options: {
        count: 500,
        offset,
        account_ids: accountIds,
      },
    });

    allTransactions.push(...response.data.transactions);
    offset += response.data.transactions.length;
    hasMore = allTransactions.length < response.data.total_transactions;
  }

  return allTransactions.map((t) => ({
    id: t.transaction_id,
    accountId: t.account_id,
    date: t.date,
    amount: t.amount,
    name: t.name,
    merchantName: t.merchant_name ?? null,
    category: t.category ?? [],
    pending: t.pending,
  }));
}

// ─── Sync transactions (incremental, using cursor) ────────

export async function syncTransactions(
  accessToken: string,
  existingCursor?: string
): Promise<{
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removedIds: string[];
  nextCursor: string;
}> {
  const plaid = createPlaidClient();
  const added: Transaction[] = [];
  const modified: Transaction[] = [];
  const removedIds: string[] = [];
  let hasMore = true;
  // Resume from persisted cursor — without this every call re-fetches all history
  let cursor: string | undefined = existingCursor;

  while (hasMore) {
    const response = await plaid.transactionsSync({
      access_token: accessToken,
      cursor,
    });
    added.push(...response.data.added);
    modified.push(...response.data.modified);
    removedIds.push(...response.data.removed.map((r) => r.transaction_id));
    hasMore = response.data.has_more;
    cursor = response.data.next_cursor;
  }

  const toPlaid = (t: Transaction): PlaidTransaction => ({
    id: t.transaction_id,
    accountId: t.account_id,
    date: t.date,
    amount: t.amount,
    name: t.name,
    merchantName: t.merchant_name ?? null,
    category: t.category ?? [],
    pending: t.pending,
  });

  return {
    added: added.map(toPlaid),
    modified: modified.map(toPlaid),
    removedIds,
    nextCursor: cursor ?? "",
  };
}
