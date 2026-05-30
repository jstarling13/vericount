// Plaid webhook verification using JWK-signed JWTs.
// Plaid sends a `Plaid-Verification` header on every webhook containing a JWT
// whose payload includes the SHA-256 hash of the request body.
//
// In sandbox mode, verification is skipped (Plaid test events don't include the header).
// In production, this MUST pass or the request is rejected.
//
// Docs: https://plaid.com/docs/api/webhooks/webhook-verification/

import crypto from "crypto";
import { importJWK, jwtVerify } from "jose";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

interface CachedKey {
  key: Parameters<typeof jwtVerify>[1];
  expiresAt: number;
}

const jwkCache = new Map<string, CachedKey>();
const JWK_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function createPlaidClient(): PlaidApi {
  const env = process.env.PLAID_ENV ?? "sandbox";
  return new PlaidApi(
    new Configuration({
      basePath:
        env === "production"
          ? PlaidEnvironments.production
          : env === "development"
          ? PlaidEnvironments.development
          : PlaidEnvironments.sandbox,
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
          "PLAID-SECRET": process.env.PLAID_SECRET!,
        },
      },
    })
  );
}

export async function verifyPlaidWebhook(
  rawBody: Buffer,
  signedJWT: string | undefined
): Promise<boolean> {
  // In sandbox mode, Plaid test webhook events don't include the verification header.
  // Skip verification so developer tooling and Plaid's dashboard tester work.
  if (process.env.PLAID_ENV !== "production") {
    return true;
  }

  if (!signedJWT) {
    console.warn("[plaid-verify] Missing Plaid-Verification header in production mode");
    return false;
  }

  try {
    // Extract key_id from JWT header (without verifying signature yet)
    const [rawHeader] = signedJWT.split(".");
    const header = JSON.parse(Buffer.from(rawHeader, "base64url").toString("utf8")) as {
      kid?: string;
      alg?: string;
    };
    const keyId = header.kid;
    if (!keyId) return false;

    // Fetch and cache the JWK for this key_id
    let cached = jwkCache.get(keyId);
    if (!cached || cached.expiresAt < Date.now()) {
      const plaid = createPlaidClient();
      const res = await plaid.webhookVerificationKeyGet({ key_id: keyId });
      const jwk = res.data.key as Record<string, unknown>;
      const alg = (jwk.alg as string | undefined) ?? "ES256";
      const cryptoKey = await importJWK(jwk as Parameters<typeof importJWK>[0], alg);
      cached = { key: cryptoKey, expiresAt: Date.now() + JWK_CACHE_TTL_MS };
      jwkCache.set(keyId, cached);
    }

    // Verify JWT signature and extract payload
    const { payload } = await jwtVerify(signedJWT, cached.key);

    // Verify the body hash matches — prevents request body tampering
    const actualHash = crypto.createHash("sha256").update(rawBody).digest("hex");
    return payload.request_body_sha256 === actualHash;
  } catch (err) {
    console.error("[plaid-verify] Verification failed:", err);
    return false;
  }
}
