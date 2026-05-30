import { WebClient } from "@slack/web-api";

// Reuse a single WebClient instance for the process lifetime.
// Creating a new client per call wastes memory and HTTP keep-alive connections.
let _slack: WebClient | null = null;

function getSlack(): WebClient {
  if (!_slack) {
    _slack = new WebClient(process.env.SLACK_BOT_TOKEN!);
  }
  return _slack;
}

// ─── Channel management ───────────────────────────────────

// Creates a private channel named "client-{slug}" and invites the bot.
// Returns the channel ID.
export async function createClientChannel(
  clientName: string,
  clientId: string
): Promise<string> {
  const slack = getSlack();
  const slug = clientName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  const channelName = `client-${slug}`;

  const result = await slack.conversations.create({
    name: channelName,
    is_private: true,
  });

  const channelId = result.channel?.id;
  if (!channelId) throw new Error("Failed to create Slack channel");

  // Post initial welcome message
  await slack.chat.postMessage({
    channel: channelId,
    text: `Welcome! This is the internal channel for *${clientName}* (ID: ${clientId}). Use this channel to track notes and flags for this account.`,
    mrkdwn: true,
  });

  return channelId;
}

// ─── Messaging ────────────────────────────────────────────

export async function postToChannel(
  channelId: string,
  text: string,
  blocks?: unknown[]
): Promise<void> {
  const slack = getSlack();
  await slack.chat.postMessage({
    channel: channelId,
    text,
    ...(blocks ? { blocks: blocks as Parameters<typeof slack.chat.postMessage>[0]["blocks"] } : {}),
  });
}

// ─── Notify about flagged items ───────────────────────────

export async function notifyFlag(
  channelId: string,
  clientName: string,
  flagType: string,
  description: string,
  dashboardUrl: string
): Promise<void> {
  await postToChannel(
    channelId,
    `:triangular_flag_on_post: *${flagType}* — ${description}`,
    [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:triangular_flag_on_post: *Action required for ${clientName}*\n*Type:* ${flagType}\n*Details:* ${description}`,
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "View in Dashboard" },
          url: dashboardUrl,
          action_id: "view_dashboard",
        },
      },
    ]
  );
}

// ─── Report delivery notification ────────────────────────

export async function notifyReportSent(
  channelId: string,
  clientName: string,
  period: string
): Promise<void> {
  await postToChannel(
    channelId,
    `:white_check_mark: Monthly report for *${clientName}* (${period}) has been generated and emailed.`
  );
}
