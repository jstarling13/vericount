import { getAuthenticatedClient, getUnreadMessageCount } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const client = await getAuthenticatedClient();
  const unreadMessages = await getUnreadMessageCount(client.id);

  return (
    <div className="flex min-h-screen">
      <Sidebar businessName={client.businessName} unreadMessages={unreadMessages} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
