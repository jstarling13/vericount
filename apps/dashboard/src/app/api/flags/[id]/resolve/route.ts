import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@vericount/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.flaggedItem.update({
    where: { id },
    data: { resolved: true, resolvedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
