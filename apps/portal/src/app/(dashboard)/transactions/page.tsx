import { getAuthenticatedClient } from "@/lib/auth";
import { prisma } from "@vericount/db";
import { TransactionTable } from "@/components/TransactionTable";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; category?: string; search?: string; month?: string }>;
}) {
  const client = await getAuthenticatedClient();
  const params = await searchParams;
  const page = parseInt(params.page ?? "1");
  const pageSize = 50;
  const category = params.category;
  const search = params.search?.trim() ?? "";
  const isUncategorized = category === "__uncategorized__";

  // Month filter: "YYYY-MM" string or undefined for all time
  const monthParam = params.month; // e.g. "2025-03"
  let dateRange: { gte: Date; lt: Date } | undefined;
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-").map(Number);
    dateRange = {
      gte: new Date(y, m - 1, 1),
      lt: new Date(y, m, 1),
    };
  }

  const where = {
    clientId: client.id,
    pending: false,
    ...(dateRange ? { date: dateRange } : {}),
    ...(isUncategorized
      ? { qboCategory: null }
      : category
      ? { qboCategory: category }
      : {}),
    ...(search
      ? {
          OR: [
            { description: { contains: search, mode: "insensitive" as const } },
            { merchant: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [transactions, total, categories, uncategorizedCount, availableMonths] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { date: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.transaction.count({ where }),
    prisma.transaction
      .findMany({
        where: { clientId: client.id, qboCategory: { not: null } },
        select: { qboCategory: true },
        distinct: ["qboCategory"],
        orderBy: { qboCategory: "asc" },
      })
      .then((rows) => rows.map((r) => r.qboCategory!).filter(Boolean)),
    prisma.transaction.count({
      where: { clientId: client.id, pending: false, qboCategory: null },
    }),
    // Distinct months with transactions — use DATE_TRUNC at DB level to avoid
    // pulling every transaction date into Node just to dedupe them.
    prisma.$queryRaw<{ month: string }[]>`
      SELECT DISTINCT TO_CHAR(DATE_TRUNC('month', date), 'YYYY-MM') AS month
      FROM "Transaction"
      WHERE "clientId" = ${client.id} AND pending = false
      ORDER BY month DESC
    `.then((rows) => rows.map((r) => r.month)),
  ]);

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Transactions</h1>
      <TransactionTable
        transactions={transactions.map((t) => ({
          id: t.id,
          date: t.date.toISOString(),
          description: t.description,
          merchant: t.merchant,
          amount: Number(t.amount),
          qboCategory: t.qboCategory,
          reviewed: t.reviewed,
          pending: t.pending,
        }))}
        total={total}
        page={page}
        pageSize={pageSize}
        categories={categories}
        selectedCategory={category}
        uncategorizedCount={uncategorizedCount}
        availableMonths={availableMonths}
        selectedMonth={monthParam}
        search={search}
      />
    </div>
  );
}
