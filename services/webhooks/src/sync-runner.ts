// Runs a bank sync for a single client from within the webhook process.
// Kept in parity with services/bank-sync/src/sync.ts — both services use the
// same Plaid cursor, QBO push, and AI categorization logic.

import { prisma } from "@vericount/db";
import { syncTransactions, getAccounts } from "@vericount/plaid";
import { refreshAccessToken, createExpense, createDeposit, getChartOfAccounts } from "@vericount/qbo";
import { categorizeTx } from "@vericount/ai";
import { PLAID_TO_QBO } from "@vericount/shared";
import { Decimal } from "@prisma/client/runtime/library";

const LARGE_TX_THRESHOLD = 5000;

type CatRule = { isRegex: boolean; pattern: string; qboCategory: string };

async function resolveCategory(
  clientId: string,
  txName: string,
  merchant: string | null,
  plaidCategory: string[],
  amount: number,
  prefetchedRules?: CatRule[]
): Promise<{ qboCategory: string; source: string } | null> {
  // 1. Client rules — use pre-fetched list when available to avoid N+1 in loops
  const rules = prefetchedRules ?? await prisma.categorizationRule.findMany({
    where: { clientId, isActive: true },
    orderBy: { priority: "desc" },
  });
  const haystack = [txName, merchant ?? ""].join(" ").toLowerCase();
  for (const rule of rules) {
    const matches = rule.isRegex
      ? (() => { try { return new RegExp(rule.pattern, "i").test(haystack); } catch { return false; } })()
      : haystack.includes(rule.pattern.toLowerCase());
    if (matches) return { qboCategory: rule.qboCategory, source: "rule" };
  }

  // 2. Plaid category map (canonical from @vericount/shared)
  for (let i = plaidCategory.length; i > 0; i--) {
    const key = plaidCategory.slice(0, i).join(".");
    if (PLAID_TO_QBO[key]) return { qboCategory: PLAID_TO_QBO[key], source: "plaid" };
  }

  // 3. AI fallback
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const aiCategory = await categorizeTx({
        description: txName,
        merchant,
        plaidCategory: plaidCategory.join(" > "),
        amount,
      });
      if (aiCategory) return { qboCategory: aiCategory, source: "ai" };
    } catch { /* fall through */ }
  }

  return null;
}

export async function syncClient(clientId: string): Promise<void> {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client?.plaidAccessToken) return;
  if (client.plaidNeedsLogin) {
    console.log(`[sync-runner] ${clientId}: ITEM_LOGIN_REQUIRED — skipping`);
    return;
  }

  const log = await prisma.syncLog.create({
    data: { clientId, type: "plaid", status: "RUNNING" },
  });

  try {
    // Refresh account balances
    const accounts = await getAccounts(client.plaidAccessToken);
    for (const acct of accounts) {
      await prisma.plaidAccount.upsert({
        where: { plaidAccountId: acct.account_id },
        update: {
          currentBalance: acct.balances.current ? new Decimal(acct.balances.current) : undefined,
          lastSynced: new Date(),
        },
        create: {
          clientId,
          plaidAccountId: acct.account_id,
          name: acct.name,
          officialName: acct.official_name ?? null,
          type: acct.type,
          subtype: acct.subtype ?? null,
          mask: acct.mask ?? null,
          currentBalance: acct.balances.current ? new Decimal(acct.balances.current) : null,
          lastSynced: new Date(),
        },
      });
    }

    const { added, modified, removedIds, nextCursor } = await syncTransactions(
      client.plaidAccessToken,
      client.plaidSyncCursor ?? undefined
    );

    if (nextCursor) {
      await prisma.client.update({ where: { id: clientId }, data: { plaidSyncCursor: nextCursor } });
    }

    if (removedIds.length > 0) {
      await prisma.transaction.deleteMany({ where: { plaidTransactionId: { in: removedIds } } });
    }

    // Pre-fetch data needed inside the transaction loop to avoid N+1 queries
    const [clientRules, dbAccountsList, existingFlags] = await Promise.all([
      prisma.categorizationRule.findMany({
        where: { clientId, isActive: true },
        orderBy: { priority: "desc" },
      }),
      prisma.plaidAccount.findMany({
        where: { clientId },
        select: { id: true, plaidAccountId: true },
      }),
      prisma.flaggedItem.findMany({
        where: { clientId, resolved: false, referenceId: { not: null } },
        select: { type: true, referenceId: true },
      }),
    ]);
    const dbAccountMap = new Map(dbAccountsList.map((a) => [a.plaidAccountId, a]));
    const flaggedSet = new Set(existingFlags.map((f) => `${f.type}::${f.referenceId}`));

    let newCount = 0;
    let flaggedCount = 0;

    for (const tx of [...added, ...modified]) {
      const dbAcct = dbAccountMap.get(tx.accountId);
      if (!dbAcct) continue;

      const cat = await resolveCategory(clientId, tx.name, tx.merchantName, tx.category, tx.amount, clientRules);
      const isLarge = Math.abs(tx.amount) >= LARGE_TX_THRESHOLD;

      await prisma.transaction.upsert({
        where: { plaidTransactionId: tx.id },
        update: {
          date: new Date(tx.date),
          amount: new Decimal(tx.amount),
          description: tx.name,
          merchant: tx.merchantName,
          plaidCategory: tx.category.join(" > "),
          qboCategory: cat?.qboCategory ?? undefined,
          categorySource: cat?.source ?? undefined,
          pending: tx.pending,
        },
        create: {
          clientId,
          accountId: dbAcct.id,
          plaidTransactionId: tx.id,
          date: new Date(tx.date),
          amount: new Decimal(tx.amount),
          description: tx.name,
          merchant: tx.merchantName,
          plaidCategory: tx.category.join(" > "),
          qboCategory: cat?.qboCategory ?? null,
          categorySource: cat?.source ?? null,
          pending: tx.pending,
        },
      });

      newCount++;

      const largeFlagKey = `large_transaction::${tx.id}`;
      if (isLarge && !tx.pending && !flaggedSet.has(largeFlagKey)) {
        await prisma.flaggedItem.create({
          data: { clientId, type: "large_transaction", description: `$${Math.abs(tx.amount).toFixed(2)}: "${tx.name}" on ${tx.date}`, referenceId: tx.id },
        });
        flaggedSet.add(largeFlagKey);
        flaggedCount++;
      }

      const uncatFlagKey = `uncategorized_tx::${tx.id}`;
      if (!cat && !tx.pending && !flaggedSet.has(uncatFlagKey)) {
        await prisma.flaggedItem.create({
          data: { clientId, type: "uncategorized_tx", description: `Uncategorized: "${tx.name}" ($${Math.abs(tx.amount).toFixed(2)}) on ${tx.date}`, referenceId: tx.id },
        });
        flaggedSet.add(uncatFlagKey);
        flaggedCount++;
      }
    }

    // Push categorized transactions to QBO if connected
    if (client.qboAccessToken && client.qboRealmId) {
      const now = new Date();
      const expiry = client.qboTokenExpiry;
      let accessToken = client.qboAccessToken;
      if (!expiry || expiry.getTime() - now.getTime() < 5 * 60 * 1000) {
        if (client.qboRefreshToken) {
          const fresh = await refreshAccessToken(client.qboRefreshToken);
          await prisma.client.update({
            where: { id: clientId },
            data: { qboAccessToken: fresh.accessToken, qboRefreshToken: fresh.refreshToken, qboTokenExpiry: fresh.accessTokenExpiry },
          });
          accessToken = fresh.accessToken;
        }
      }
      await pushToQBO(clientId, accessToken, client.qboRealmId);
    }

    await prisma.syncLog.update({
      where: { id: log.id },
      data: { status: "SUCCESS", completedAt: new Date(), details: `${newCount} transactions processed, ${flaggedCount} flagged` },
    });
  } catch (err) {
    const msg = (err as Error).message;
    await prisma.syncLog.update({ where: { id: log.id }, data: { status: "ERROR", completedAt: new Date(), errorMsg: msg } });
    throw err;
  }
}

async function pushToQBO(clientId: string, accessToken: string, realmId: string): Promise<void> {
  const pending = await prisma.transaction.findMany({
    where: { clientId, pushedToQbo: false, pending: false, qboCategory: { not: null } },
    take: 50,
  });
  if (pending.length === 0) return;

  let accountMap: Record<string, string> = {};
  try {
    const accounts = await getChartOfAccounts(accessToken, realmId);
    accountMap = Object.fromEntries(accounts.map((a) => [a.name, a.id]));
  } catch { return; }

  for (const tx of pending) {
    const accountId = accountMap[tx.qboCategory!];
    if (!accountId) continue;
    try {
      const dateStr = tx.date.toISOString().split("T")[0];
      const amount = Math.abs(Number(tx.amount));
      if (Number(tx.amount) > 0) {
        await createExpense(accessToken, realmId, { date: dateStr, amount, description: tx.description, accountRef: accountId, vendorName: tx.merchant ?? undefined });
      } else {
        await createDeposit(accessToken, realmId, { date: dateStr, amount, description: tx.description, depositAccountRef: accountId });
      }
      await prisma.transaction.update({ where: { id: tx.id }, data: { pushedToQbo: true, pushedToQboAt: new Date() } });
    } catch { /* skip, will retry next cycle */ }
  }
}
