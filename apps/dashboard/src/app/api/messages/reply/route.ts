import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@vericount/db";
import { postToChannel } from "@vericount/slack";

export async function POST(req: NextRequest) {
  let clientId: string;
  let content: string;

  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await req.json() as { clientId: string; content: string };
    clientId = body.clientId;
    content = body.content;
  } else {
    const formData = await req.formData();
    clientId = formData.get("clientId") as string;
    content = formData.get("content") as string;
  }

  if (!content?.trim()) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const message = await prisma.message.create({
    data: { clientId, sender: "BOOKKEEPER", content: content.trim() },
  });

  if (client.slackChannelId) {
    postToChannel(
      client.slackChannelId,
      `:speech_balloon: *Message sent to ${client.name}:* "${content.trim()}"`
    ).catch(() => {});
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
