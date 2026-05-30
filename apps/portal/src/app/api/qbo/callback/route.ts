import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@vericount/qbo";
import { prisma } from "@vericount/db";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const realmId = searchParams.get("realmId");
  const stateParam = searchParams.get("state");
  const error = searchParams.get("error");

  // Parse clientId from state early so we can use it in error redirects
  let clientId = "";
  if (stateParam) {
    try {
      const stateData = JSON.parse(Buffer.from(stateParam, "base64url").toString()) as { clientId: string };
      clientId = stateData.clientId;
    } catch { /* fall through — clientId stays empty */ }
  }

  const retryUrl = clientId
    ? `/connect-qbo?clientId=${clientId}`
    : "/connect-qbo";

  if (error) {
    return NextResponse.redirect(
      new URL(`${retryUrl}&error=qbo_denied`, req.nextUrl.origin)
    );
  }

  if (!code || !realmId || !stateParam) {
    return NextResponse.redirect(
      new URL(`${retryUrl}&error=qbo_missing_params`, req.nextUrl.origin)
    );
  }

  if (!clientId) {
    return NextResponse.redirect(
      new URL(`/connect-qbo?error=qbo_bad_state`, req.nextUrl.origin)
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(req.nextUrl.toString(), realmId);

    const client = await prisma.client.update({
      where: { id: clientId },
      data: {
        qboRealmId: tokens.realmId,
        qboAccessToken: tokens.accessToken,
        qboRefreshToken: tokens.refreshToken,
        qboTokenExpiry: tokens.accessTokenExpiry,
      },
    });

    // Send portal invite email (fire-and-forget)
    sendPortalInviteEmail(client).catch(() => {});

    // Redirect to portal dashboard if signed in, otherwise to sign-up
    return NextResponse.redirect(
      new URL(`/dashboard?success=qbo_connected`, req.nextUrl.origin)
    );
  } catch (err) {
    console.error("[qbo/callback] Token exchange failed:", err);
    return NextResponse.redirect(
      new URL(`${retryUrl}&error=qbo_token_failed`, req.nextUrl.origin)
    );
  }
}

async function sendPortalInviteEmail(client: {
  name: string;
  email: string;
  businessName: string;
}): Promise<void> {
  const portalUrl = process.env.PORTAL_URL ?? "https://portal.vericount.com";
  const signUpUrl = `${portalUrl}/sign-up`;

  await resend.emails.send({
    from: `${process.env.RESEND_FROM_NAME} <${process.env.RESEND_FROM_EMAIL}>`,
    to: [client.email],
    subject: `QuickBooks connected — your Vericount portal is ready`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;max-width:580px;margin:0 auto;color:#1a1a1a">
  <div style="background:#0f4c81;padding:28px 32px;border-radius:8px 8px 0 0">
    <h1 style="color:white;margin:0;font-size:22px">QuickBooks Connected!</h1>
    <p style="color:rgba(255,255,255,.75);margin:4px 0 0;font-size:14px">${client.businessName}</p>
  </div>
  <div style="padding:28px 32px;background:#f7f8fa;border-radius:0 0 8px 8px">
    <p style="margin-top:0">Hi ${client.name},</p>
    <p>Your QuickBooks Online account is now connected to Vericount. I'll start categorizing your transactions and building your books.</p>

    <div style="background:white;border-radius:8px;padding:20px 24px;margin:20px 0;border:1px solid #e5e7eb">
      <p style="margin:0 0 12px;font-weight:700;font-size:14px;color:#111">Your portal is ready</p>
      <p style="margin:0 0 12px;font-size:14px;color:#374151">Create your free account to:</p>
      <ul style="margin:0 0 16px;padding:0 0 0 20px;font-size:14px;color:#374151;line-height:1.8">
        <li>View your monthly financial reports</li>
        <li>See your transaction history</li>
        <li>Check your quarterly tax estimates</li>
        <li>Send me messages anytime</li>
      </ul>
      <a href="${signUpUrl}" style="background:#0f4c81;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">
        Create Your Portal Account →
      </a>
    </div>

    <p style="font-size:13px;color:#6b7280">
      Use your email address <strong>${client.email}</strong> when signing up so your account is linked automatically.
    </p>
    <p style="font-size:12px;color:#9ca3af;margin-top:24px">
      Questions? Reply to this email — I'm here to help.
    </p>
  </div>
</body>
</html>`,
  });
}
