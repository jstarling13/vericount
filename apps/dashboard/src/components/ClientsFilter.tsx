"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useState, useRef } from "react";

const STATUSES = ["ACTIVE", "PENDING", "SUSPENDED", "CHURNED"] as const;
const TIERS = ["STARTER", "GROWTH", "PRO"] as const;

export function ClientsFilter({
  search,
  status,
  tier,
}: {
  search: string;
  status: string;
  tier: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [searchValue, setSearchValue] = useState(search);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("page"); // reset pagination on filter change
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  function handleSearchChange(value: string) {
    setSearchValue(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => update("search", value), 400);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search */}
      <input
        type="search"
        placeholder="Search clients…"
        value={searchValue}
        onChange={(e) => handleSearchChange(e.target.value)}
        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-52 focus:outline-none focus:ring-1 focus:ring-[#0f4c81]/30 bg-white"
      />

      {/* Status filter */}
      <div className="flex gap-1">
        <button
          onClick={() => update("status", "")}
          className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
            !status ? "bg-[#0f4c81] text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
          }`}
        >
          All
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => update("status", status === s ? "" : s)}
            className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
              status === s ? "bg-[#0f4c81] text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Tier filter */}
      <div className="flex gap-1">
        {TIERS.map((t) => (
          <button
            key={t}
            onClick={() => update("tier", tier === t ? "" : t)}
            className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
              tier === t ? "bg-[#0f4c81] text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {t.charAt(0) + t.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
