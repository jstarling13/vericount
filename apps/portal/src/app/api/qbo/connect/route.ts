import { NextRequest, NextResponse } from "next/server";
import { getAuthorizationUrl } from "@vericount/qbo";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "Missing clientId" }, { status: 400 });
  }

  // state encodes our DB clientId so the callback can link the tokens
  const state = Buffer.from(JSON.stringify({ clientId })).toString("base64url");
  const authUrl = getAuthorizationUrl(state);
  return NextResponse.redirect(authUrl);
}
