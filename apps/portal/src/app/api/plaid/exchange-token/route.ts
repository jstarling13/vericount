import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { exchangePublicToken, getAccounts } from "@vericount/plaid";
import { prisma } from "@vericount/db";
import { Decimal } from "@prisma/client/runtime/library";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { publicToken, clientId } = await req.json() as { publicToken: string; clientId: string };

  const client = await prisma.client.findFirst({
    where: { id: clientId, clerkUserId: userId },
  });
  if (!client) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { accessToken, itemId } = await exchangePublicToken(publicToken);

  await prisma.client.update({
    where: { id: clientId },
    data: { plaidAccessToken: accessToken, plaidItemId: itemId, plaidNeedsLogin: false },
  });

  // Resolve any open plaid_login_required flag
  await prisma.flaggedItem.updateMany({
    where: { clientId, type: "plaid_login_required", resolved: false },
    data: { resolved: true, resolvedAt: new Date() },
  });

  // Immediately pull and save accounts (also refreshes balance + metadata on reconnect)
  const accounts = await getAccounts(accessToken);
  for (const acct of accounts) {
    await prisma.plaidAccount.upsert({
      where: { plaidAccountId: acct.account_id },
      update: {
        name: acct.name,
        officialName: acct.official_name ?? null,
        currentBalance: acct.balances.current ? new Decimal(acct.balances.current) : undefined,
        mask: acct.mask ?? null,
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

  return NextResponse.json({ ok: true, accountCount: accounts.length });
}
