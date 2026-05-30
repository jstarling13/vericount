import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@vericount/db";
import { updateSubscriptionTier } from "@vericount/stripe-client";
import { z } from "zod";

const PatchSchema = z.object({
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "CHURNED"]).optional(),
  tier: z.enum(["STARTER", "GROWTH", "PRO"]).optional(),
  notes: z.string().optional(), // future: client notes field
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      plaidAccounts: true,
      reports: { orderBy: { period: "desc" }, take: 12 },
      taxEstimates: { orderBy: { year: "desc" } },
      flaggedItems: { where: { resolved: false } },
      syncLogs: { orderBy: { startedAt: "desc" }, take: 10 },
      _count: { select: { transactions: true, messages: true } },
    },
  });

  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(client);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { status, tier, notes } = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (status !== undefined) updateData.status = status;
  if (tier !== undefined) updateData.tier = tier;
  if (notes !== undefined) updateData.notes = notes;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.client.update({ where: { id }, data: updateData });

  // Keep Stripe subscription in sync when tier changes
  if (tier !== undefined && updated.stripeSubscriptionId) {
    try {
      await updateSubscriptionTier(updated.stripeSubscriptionId, tier);
    } catch (err) {
      // Log but don't fail — DB is source of truth, Stripe sync is best-effort
      console.error(`[api/clients] Stripe tier update failed for ${id}:`, (err as Error).message);
    }
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // Soft delete: set status to CHURNED rather than hard delete
  const updated = await prisma.client.update({
    where: { id },
    data: { status: "CHURNED" },
  });
  return NextResponse.json(updated);
}
