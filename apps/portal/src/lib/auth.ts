// Resolves the DB client record for the currently signed-in Clerk user.
// On first visit, links the clerkUserId to the matching email record.
//
// Wrapped in React cache() so layout + page calling this in the same render
// share the result — only one DB round-trip per request instead of two.

import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma, Client } from "@vericount/db";
import { redirect } from "next/navigation";

export const getAuthenticatedClient = cache(async function getAuthenticatedClient(): Promise<Client> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Fast path: already linked
  const byClerkId = await prisma.client.findUnique({ where: { clerkUserId: userId } });
  if (byClerkId) return byClerkId;

  // First sign-in: link by email
  const clerkUser = await currentUser();
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress;
  if (!email) redirect("/sign-in");

  const byEmail = await prisma.client.findUnique({ where: { email } });
  if (!byEmail) {
    // Client signed up via Clerk but has no DB record — shouldn't normally happen
    // unless they bypassed the onboarding form. Show a "pending" page.
    redirect("/pending");
  }

  // Link and return
  return prisma.client.update({
    where: { id: byEmail.id },
    data: { clerkUserId: userId },
  });
});

// Cached per render — layout and dashboard page both need this; share the query.
export const getUnreadMessageCount = cache(async function getUnreadMessageCount(clientId: string): Promise<number> {
  return prisma.message.count({
    where: { clientId, sender: "BOOKKEEPER", readAt: null },
  });
});
