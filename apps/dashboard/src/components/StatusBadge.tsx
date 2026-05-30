export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    ACTIVE: { label: "Active", cls: "bg-green-100 text-green-700" },
    PENDING: { label: "Pending", cls: "bg-yellow-100 text-yellow-700" },
    SUSPENDED: { label: "Suspended", cls: "bg-orange-100 text-orange-700" },
    CHURNED: { label: "Churned", cls: "bg-red-100 text-red-600" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "bg-gray-100 text-gray-500" };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  );
}
