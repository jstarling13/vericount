import { prisma, Client } from "@vericount/db";
import { syncTransactions, getAccounts } from "@vericount/plaid";
import { refreshAccessToken } from "@vericount/qbo";
import { createExpense, createDeposit, getChartOfAccounts } from "@vericount/qbo";
import { categorize } from "./categorization";
import { notifyFlag } from "@vericount/slack";
import { Decimal } from "@prisma/client/runtime/library";

const LARGE_TX_THRESHOLD = 5000; // flag transactions over this amount

// ─── Main per-client sync ─────────────────────────────────

export async function syncClient(client: Client): Promise<void> {
  if (!client.plaidAccessToken || !client.plaidItemId) {
    console.log(`[sync] ${client.id}: no Plaid token, skipping`);
    return;
  }
  if (client.plaidNeedsLogin) {
    console.log(`[sync] ${client.id}: ITEM_LOGIN_REQUIRED — skipping until client reconnects`);
    return;
  }

  const syncLog = await prisma.syncLog.create({
    data: { clientId: client.id, type: "plaid", status: "RUNNING" },
  });

  try {
    // 1. Sync Plaid accounts
    const accounts = await getAccounts(client.plaidAccessToken);
    for (const acct of accounts) {
      await prisma.plaidAccount.upsert({
        where: { plaidAccountId: acct.account_id },
        update: {
          currentBalance: acct.balances.current
            ? new Decimal(acct.balances.current)
            : undefined,
          lastSynced: new Date(),
        },
        create: {
          clientId: client.id,
          plaidAccountId: acct.account_id,
          name: acct.name,
          officialName: acct.official_name ?? null,
          type: acct.type,
          subtype: acct.subtype ?? null,
          mask: acct.mask ?? null,
          currentBalance: acct.balances.current
            ? new Decimal(acct.balances.current)
            : null,
          lastSynced: new Date(),
        },
      });
    }

    // 2. Pull incremental transactions via sync cursor.
    // The cursor MUST be persisted between runs — without it Plaid re-sends all
    // historical transactions on every call, causing duplicate DB records.
    const { added, modified, removedIds, nextCursor } = await syncTransactions(
      client.plaidAccessToken,
      client.plaidSyncCursor ?? undefined
    );

    // Persist the new cursor immediately so a crash mid-run doesn't lose progress
    if (nextCursor) {
      await prisma.client.update({
        where: { id: client.id },
        data: { plaidSyncCursor: nextCursor },
      });
    }

    // Remove deleted transactions
    if (removedIds.length > 0) {
      await prisma.transaction.deleteMany({
        where: { plaidTransactionId: { in: removedIds } },
      });
    }

    // Pre-fetch data needed inside the transaction loop to avoid N+1 queries.
    // Rules and DB accounts are stable across the loop; existing flags are used
    // to prevent duplicate flaggedItem records.
    const [clientRules, dbAccountsList, existingFlags] = await Promise.all([
      prisma.categorizationRule.findMany({
        where: { clientId: client.id, isActive: true },
        orderBy: { priority: "desc" },
      }),
      prisma.plaidAccount.findMany({
        where: { clientId: client.id },
        select: { id: true, plaidAccountId: true },
      }),
      prisma.flaggedItem.findMany({
        where: { clientId: client.id, resolved: false, referenceId: { not: null } },
        select: { type: true, referenceId: true },
      }),
    ]);

    // Maps for O(1) lookup inside the loop
    const dbAccountMap = new Map(dbAccountsList.map((a) => [a.plaidAccountId, a]));
    // Set of "type::referenceId" keys for deduplication
    const flaggedSet = new Set(existingFlags.map((f) => `${f.type}::${f.referenceId}`));

    let newCount = 0;
    let flaggedCount = 0;

    // 3. Upsert added + modified transactions
    for (const tx of [...added, ...modified]) {
      const dbAccount = dbAccountMap.get(tx.accountId);
      if (!dbAccount) continue;

      // Apply categorization rules (rules → Plaid map → AI fallback)
      const cat = await categorize(client.id, {
        description: tx.name,
        merchant: tx.merchantName,
        plaidCategory: tx.category,
        amount: tx.amount,
      }, clientRules);

      const isLarge = Math.abs(tx.amount) >= LARGE_TX_THRESHOLD;

      await prisma.transaction.upsert({
        where: { plaidTransactionId: tx.id },
        update: {
          date: new Date(tx.date),
          amount: new Decimal(tx.amount),
          description: tx.name,
          merchant: tx.merchantName,
          plaidCategory: tx.category.join(" > "),
          qboCategory: cat?.qboCategory ?? null,
          categorySource: cat?.source ?? null,
          pending: tx.pending,
        },
        create: {
          clientId: client.id,
          accountId: dbAccount.id,
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

      // Flag large transactions and uncategorized ones — check the pre-fetched set
      // to avoid duplicate flaggedItem records across runs.
      const largeFlagKey = `large_transaction::${tx.id}`;
      if (isLarge && !tx.pending && !flaggedSet.has(largeFlagKey)) {
        await prisma.flaggedItem.create({
          data: {
            clientId: client.id,
            type: "large_transaction",
            description: `$${Math.abs(tx.amount).toFixed(2)} transaction: "${tx.name}" on ${tx.date}`,
            referenceId: tx.id,
          },
        });
        flaggedSet.add(largeFlagKey); // prevent double-flagging within the same sync run
        flaggedCount++;
      }

      const uncatFlagKey = `uncategorized_tx::${tx.id}`;
      if (!cat && !tx.pending && !flaggedSet.has(uncatFlagKey)) {
        await prisma.flaggedItem.create({
          data: {
            clientId: client.id,
            type: "uncategorized_tx",
            description: `Uncategorized: "${tx.name}" ($${Math.abs(tx.amount).toFixed(2)}) on ${tx.date}`,
            referenceId: tx.id,
          },
        });
        flaggedSet.add(uncatFlagKey);
        flaggedCount++;
      }
    }

    // 4. Push non-pending, categorized, unsynced transactions to QBO
    if (client.qboAccessToken && client.qboRealmId) {
      const qboTokens = await ensureFreshQBOToken(client);
      const pushed = await pushToQBO(client.id, qboTokens.accessToken, client.qboRealmId);
      console.log(`[sync] ${client.id}: pushed ${pushed} transactions to QBO`);
    }

    // 5. Notify Slack about flags
    if (flaggedCount > 0 && client.slackChannelId) {
      const dashUrl = `${process.env.DASHBOARD_URL}/clients/${client.id}`;
      await notifyFlag(
        client.slackChannelId,
        client.name,
        "Sync review needed",
        `${flaggedCount} item(s) need review after nightly sync (${newCount} transactions processed).`,
        dashUrl
      );
    }

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: { status: "SUCCESS", completedAt: new Date(), details: `${newCount} transactions processed, ${flaggedCount} flagged` },
    });

    console.log(`[sync] ${client.id} (${client.name}): done — ${newCount} txs, ${flaggedCount} flags`);
  } catch (err) {
    const msg = (err as Error).message;
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: { status: "ERROR", completedAt: new Date(), errorMsg: msg },
    });
    throw err;
  }
}

// ─── Push transactions to QBO ─────────────────────────────

async function pushToQBO(
  clientId: string,
  accessToken: string,
  realmId: string
): Promise<number> {
  const pending = await prisma.transaction.findMany({
    where: {
      clientId,
      pushedToQbo: false,
      pending: false,
      qboCategory: { not: null },
    },
    take: 100,
  });

  // Skip the Chart of Accounts API call entirely if there's nothing to push
  if (pending.length === 0) return 0;

  // Build a name→ID map from QBO Chart of Accounts
  let accountMap: Record<string, string> = {};
  try {
    const accounts = await getChartOfAccounts(accessToken, realmId);
    accountMap = Object.fromEntries(accounts.map((a) => [a.name, a.id]));
  } catch {
    // If CoA fetch fails, skip QBO push this cycle
    return 0;
  }

  let pushed = 0;
  for (const tx of pending) {
    const accountId = accountMap[tx.qboCategory!];
    if (!accountId) continue;

    try {
      const dateStr = tx.date.toISOString().split("T")[0];
      const amount = Math.abs(Number(tx.amount));

      // Plaid: positive = money leaving account (debit/expense)
      //        negative = money entering account (credit/income)
      let qboId: string;
      if (Number(tx.amount) > 0) {
        const result = await createExpense(accessToken, realmId, {
          date: dateStr,
          amount,
          description: tx.description,
          accountRef: accountId,
          vendorName: tx.merchant ?? undefined,
        }) as { Purchase?: { Id: string } };
        qboId = result?.Purchase?.Id ?? "";
      } else {
        const result = await createDeposit(accessToken, realmId, {
          date: dateStr,
          amount,
          description: tx.description,
          depositAccountRef: accountId,
        }) as { Deposit?: { Id: string } };
        qboId = result?.Deposit?.Id ?? "";
      }

      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          pushedToQbo: true,
          pushedToQboAt: new Date(),
          qboTransactionId: qboId,
        },
      });
      pushed++;
    } catch (err) {
      console.error(`[sync] QBO push failed for tx ${tx.id}:`, (err as Error).message);
    }
  }

  return pushed;
}

// ─── QBO token refresh ────────────────────────────────────

async function ensureFreshQBOToken(
  client: Client
): Promise<{ accessToken: string }> {
  const now = new Date();
  const expiry = client.qboTokenExpiry;

  // Refresh if within 5 minutes of expiry
  if (!expiry || expiry.getTime() - now.getTime() < 5 * 60 * 1000) {
    if (!client.qboRefreshToken) throw new Error("No QBO refresh token available");
    const fresh = await refreshAccessToken(client.qboRefreshToken);
    await prisma.client.update({
      where: { id: client.id },
      data: {
        qboAccessToken: fresh.accessToken,
        qboRefreshToken: fresh.refreshToken,
        qboTokenExpiry: fresh.accessTokenExpiry,
      },
    });
    return { accessToken: fresh.accessToken };
  }

  return { accessToken: client.qboAccessToken! };
}
