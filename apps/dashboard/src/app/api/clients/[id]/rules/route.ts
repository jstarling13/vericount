import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@vericount/db";
import { QBO_CATEGORIES } from "@vericount/shared";
import { z } from "zod";

const RuleSchema = z.object({
  name:        z.string().min(1).max(100),
  pattern:     z.string().min(1).max(500),
  qboCategory: z.enum(QBO_CATEGORIES),
  isRegex:     z.boolean().default(false),
  priority:    z.number().int().min(0).max(1000).default(0),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clientId } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = RuleSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid rule", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  // If isRegex, validate the pattern compiles before saving
  if (parsed.data.isRegex) {
    try {
      new RegExp(parsed.data.pattern);
    } catch {
      return NextResponse.json({ error: "Invalid regular expression pattern" }, { status: 400 });
    }
  }

  const rule = await prisma.categorizationRule.create({
    data: { clientId, ...parsed.data },
  });

  return NextResponse.json({ rule });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clientId } = await params;
  const rules = await prisma.categorizationRule.findMany({
    where: { clientId, isActive: true },
    orderBy: { priority: "desc" },
  });
  return NextResponse.json({ rules });
}
