import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@vericount/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;

  await prisma.message.updateMany({
    where: { clientId, sender: "CLIENT", readAt: null },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
