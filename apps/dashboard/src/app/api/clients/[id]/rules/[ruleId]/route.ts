import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@vericount/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
  const { ruleId } = await params;
  await prisma.categorizationRule.update({
    where: { id: ruleId },
    data: { isActive: false },
  });
  return NextResponse.json({ ok: true });
}
