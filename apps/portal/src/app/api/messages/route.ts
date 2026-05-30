import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@vericount/db";
import { postToChannel } from "@vericount/slack";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { clientId, content } = await req.json() as { clientId: string; content: string };
  if (!content?.trim()) return NextResponse.json({ error: "Empty message" }, { status: 400 });

  const client = await prisma.client.findFirst({
    where: { id: clientId, clerkUserId: userId },
  });
  if (!client) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const message = await prisma.message.create({
    data: { clientId, sender: "CLIENT", content: content.trim() },
  });

  // Notify bookkeeper via Slack so they see it immediately
  if (client.slackChannelId) {
    const dashUrl = `${process.env.DASHBOARD_URL ?? "http://localhost:3002"}/clients/${clientId}`;
    postToChannel(
      client.slackChannelId,
      `:speech_balloon: *${client.name}* sent a message:\n>${content.trim()}\n<${dashUrl}|Reply in dashboard>`
    ).catch(() => { /* don't fail the request if Slack is down */ });
  }

  return NextResponse.json({
    message: {
      id: message.id,
      sender: message.sender,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    },
  });
}
