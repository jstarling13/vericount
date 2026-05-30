import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@vericount/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const client = await prisma.client.findUnique({
    where: { id },
    select: { id: true, plaidAccessToken: true },
  });

  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!client.plaidAccessToken) {
    return NextResponse.json({ error: "Client has no Plaid connection" }, { status: 422 });
  }

  const webhooksUrl = process.env.WEBHOOKS_INTERNAL_URL ?? "http://localhost:3000";
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const res = await fetch(`${webhooksUrl}/internal/sync/${id}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });

  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json({ error: `Sync service returned ${res.status}: ${body}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, queued: true });
}
