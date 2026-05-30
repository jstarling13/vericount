import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@vericount/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { year?: number; month?: number };

  const client = await prisma.client.findUnique({
    where: { id },
    select: { id: true, qboRealmId: true },
  });

  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!client.qboRealmId) {
    return NextResponse.json({ error: "Client has no QBO connection" }, { status: 422 });
  }

  const webhooksUrl = process.env.WEBHOOKS_INTERNAL_URL ?? "http://localhost:3000";
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const qs = new URLSearchParams();
  if (body.year)  qs.set("year",  String(body.year));
  if (body.month) qs.set("month", String(body.month));

  const url = `${webhooksUrl}/internal/report/${id}${qs.size ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });

  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json({ error: `Report service returned ${res.status}: ${body}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, queued: true });
}
