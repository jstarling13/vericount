import { getAuthenticatedClient } from "@/lib/auth";
import { prisma } from "@vericount/db";
import { MessageThread } from "@/components/MessageThread";

export default async function MessagesPage() {
  const client = await getAuthenticatedClient();

  const messages = await prisma.message.findMany({
    where: { clientId: client.id },
    orderBy: { createdAt: "asc" },
  });

  // Mark bookkeeper messages as read
  await prisma.message.updateMany({
    where: { clientId: client.id, sender: "BOOKKEEPER", readAt: null },
    data: { readAt: new Date() },
  });

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Messages</h1>
      <MessageThread
        clientId={client.id}
        messages={messages.map((m) => ({
          id: m.id,
          sender: m.sender,
          content: m.content,
          createdAt: m.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
