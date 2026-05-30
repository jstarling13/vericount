import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createUpdateLinkToken } from "@vericount/plaid";
import { prisma } from "@vericount/db";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "Missing clientId" }, { status: 400 });

  const client = await prisma.client.findFirst({
    where: { id: clientId, clerkUserId: userId },
  });
  if (!client || !client.plaidAccessToken) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const linkToken = await createUpdateLinkToken(client.plaidAccessToken, userId);
  return NextResponse.json({ linkToken });
}
