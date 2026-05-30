import { NextResponse } from "next/server";
import { getAuthenticatedClient } from "@/lib/auth";
import { createBillingPortalSession } from "@vericount/stripe-client";

export async function GET() {
  const client = await getAuthenticatedClient();

  if (!client.stripeCustomerId) {
    return NextResponse.redirect(new URL("/dashboard", process.env.PORTAL_URL!));
  }

  const url = await createBillingPortalSession(
    client.stripeCustomerId,
    `${process.env.PORTAL_URL}/dashboard`
  );

  return NextResponse.redirect(url);
}
