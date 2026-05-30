import docusign from "docusign-esign";
import fs from "fs";

// DocuSign uses JWT Grant (Service Integration) for server-to-server auth.
// Your private key file should be at the path in DOCUSIGN_PRIVATE_KEY_PATH.
// Get credentials from: https://developers.docusign.com/

// ─── Token cache ─────────────────────────────────────────
// DocuSign JWT access tokens are valid for 3600s. Cache them in-process
// (refreshing 5 min before expiry) to avoid a 300ms+ auth roundtrip on
// every API call.

let _cachedToken: { value: string; expiresAt: number } | null = null;
let _privateKey: Buffer | null = null;

function getPrivateKey(): Buffer {
  if (!_privateKey) {
    _privateKey = fs.readFileSync(process.env.DOCUSIGN_PRIVATE_KEY_PATH!);
  }
  return _privateKey;
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (_cachedToken && _cachedToken.expiresAt > now) {
    return _cachedToken.value;
  }

  const dsApi = new docusign.ApiClient();
  dsApi.setOAuthBasePath(
    process.env.DOCUSIGN_BASE_PATH?.includes("demo")
      ? "account-d.docusign.com"
      : "account.docusign.com"
  );

  const response = await dsApi.requestJWTUserToken(
    process.env.DOCUSIGN_INTEGRATION_KEY!,
    process.env.DOCUSIGN_USER_ID!,
    ["signature", "impersonation"],
    getPrivateKey(),
    3600
  );

  const token = response.body.access_token as string;
  // Cache for 55 minutes (5-minute safety margin before 3600s expiry)
  _cachedToken = { value: token, expiresAt: now + 55 * 60 * 1000 };
  return token;
}

function createApiClient(accessToken: string): docusign.EnvelopesApi {
  const dsApi = new docusign.ApiClient();
  dsApi.setBasePath(process.env.DOCUSIGN_BASE_PATH!);
  dsApi.addDefaultHeader("Authorization", `Bearer ${accessToken}`);
  return new docusign.EnvelopesApi(dsApi);
}

// ─── Send engagement letter via template ─────────────────

export interface EngagementLetterParams {
  clientName: string;
  clientEmail: string;
  businessName: string;
  tier: string;
  monthlyFee: number;
}

export async function sendEngagementLetter(
  params: EngagementLetterParams
): Promise<string> {
  const token = await getAccessToken();
  const envelopesApi = createApiClient(token);

  const envDef = new docusign.EnvelopeDefinition();
  envDef.templateId = process.env.DOCUSIGN_ENGAGEMENT_TEMPLATE_ID!;
  envDef.status = "sent";

  const signer = docusign.TemplateRole.constructFromObject({
    email: params.clientEmail,
    name: params.clientName,
    roleName: "client",
    tabs: {
      textTabs: [
        docusign.Text.constructFromObject({
          tabLabel: "BusinessName",
          value: params.businessName,
        }),
        docusign.Text.constructFromObject({
          tabLabel: "ServiceTier",
          value: params.tier,
        }),
        docusign.Text.constructFromObject({
          tabLabel: "MonthlyFee",
          value: `$${params.monthlyFee}/month`,
        }),
      ],
    },
  });

  envDef.templateRoles = [signer];

  const result = await envelopesApi.createEnvelope(
    process.env.DOCUSIGN_ACCOUNT_ID!,
    { envelopeDefinition: envDef }
  );

  return result.envelopeId!;
}

// ─── Check envelope status ────────────────────────────────

export async function getEnvelopeStatus(envelopeId: string): Promise<string> {
  const token = await getAccessToken();
  const envelopesApi = createApiClient(token);
  const result = await envelopesApi.getEnvelope(
    process.env.DOCUSIGN_ACCOUNT_ID!,
    envelopeId,
    {}
  );
  return result.status ?? "unknown";
}
