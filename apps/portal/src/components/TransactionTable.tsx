"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useRef } from "react";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Tx {
  id: string;
  date: string;
  description: string;
  merchant: string | null;
  amount: number;
  qboCategory: string | null;
  reviewed: boolean;
  pending: boolean;
}

export function TransactionTable({
  transactions,
  total,
  page,
  pageSize,
  categories,
  selectedCategory,
  uncategorizedCount,
  availableMonths,
  selectedMonth,
  search,
}: {
  transactions: Tx[];
  total: number;
  page: number;
  pageSize: number;
  categories: string[];
  selectedCategory?: string;
  uncategorizedCount?: number;
  availableMonths?: string[];
  selectedMonth?: string;
  search?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const totalPages = Math.ceil(total / pageSize);

  // Local controlled state for the search input — debounced to avoid
  // triggering a server navigation (and DB query) on every single keystroke.
  const [searchValue, setSearchValue] = useState(search ?? "");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearchChange(value: string) {
    setSearchValue(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(value), 400);
  }

  function setFilter(category: string | undefined) {
    const p = new URLSearchParams(searchParams.toString());
    if (category) p.set("category", category);
    else p.delete("category");
    p.set("page", "1");
    router.push(`?${p.toString()}`);
  }

  function setSearch(value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set("search", value);
    else p.delete("search");
    p.set("page", "1");
    router.push(`?${p.toString()}`);
  }

  function setMonth(month: string | undefined) {
    const p = new URLSearchParams(searchParams.toString());
    if (month) p.set("month", month);
    else p.delete("month");
    p.set("page", "1");
    router.push(`?${p.toString()}`);
  }

  function fmtMonth(key: string): string {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }

  function setPage(n: number) {
    const p = new URLSearchParams(searchParams.toString());
    p.set("page", String(n));
    router.push(`?${p.toString()}`);
  }

  return (
    <div>
      {/* Search */}
      <div className="mb-3">
        <input
          type="search"
          placeholder="Search by description or merchant…"
          value={searchValue}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full text-sm border border-gray-200 rounded-lg px-4 py-2 focus:outline-none focus:ring-1 focus:ring-[#0f4c81]/30 bg-white"
        />
      </div>

      {/* Month filter */}
      {availableMonths && availableMonths.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            onClick={() => setMonth(undefined)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              !selectedMonth
                ? "bg-gray-700 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            All time
          </button>
          {availableMonths.map((m) => (
            <button
              key={m}
              onClick={() => setMonth(m)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                selectedMonth === m
                  ? "bg-gray-700 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {fmtMonth(m)}
            </button>
          ))}
        </div>
      )}

      {/* Category filter */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => setFilter(undefined)}
          className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
            !selectedCategory
              ? "bg-[#0f4c81] text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          All
        </button>
        {!!uncategorizedCount && (
          <button
            onClick={() => setFilter("__uncategorized__")}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors flex items-center gap-1.5 ${
              selectedCategory === "__uncategorized__"
                ? "bg-amber-500 text-white"
                : "bg-amber-50 text-amber-700 hover:bg-amber-100"
            }`}
          >
            Uncategorized
            <span className={`text-xs font-bold rounded-full px-1.5 py-0 leading-4 ${
              selectedCategory === "__uncategorized__"
                ? "bg-white/30 text-white"
                : "bg-amber-200 text-amber-800"
            }`}>
              {uncategorizedCount}
            </span>
          </button>
        )}
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              selectedCategory === cat
                ? "bg-[#0f4c81] text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-12 text-gray-400 text-sm">
                    No transactions found.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 text-gray-500 whitespace-nowrap">
                      {formatDate(tx.date)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-900">{tx.description}</div>
                      {tx.merchant && tx.merchant !== tx.description && (
                        <div className="text-xs text-gray-400">{tx.merchant}</div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {tx.qboCategory ? (
                        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                          {tx.qboCategory}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className={`px-5 py-3 text-right font-semibold whitespace-nowrap ${
                      tx.amount < 0 ? "text-green-600" : "text-gray-900"
                    }`}>
                      {formatCurrency(tx.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-400">
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 disabled:opacity-40 hover:bg-gray-200 transition-colors"
              >
                ← Prev
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 disabled:opacity-40 hover:bg-gray-200 transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
