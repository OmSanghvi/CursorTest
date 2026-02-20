import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export async function POST(request: Request) {
  const body = await request.json();

  // Slack URL verification (needed for setting up the webhook)
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  // Handle Slack event
  if (body.event && body.event.type === "message" && !body.event.bot_id) {
    const { text, user, channel } = body.event;

    // Trigger Inngest function to process Slack message
    await inngest.send({
      name: "integration/slack/message",
      data: {
        text,
        user,
        channel,
        source: "slack",
      },
    });
  }

  return NextResponse.json({ ok: true });
}
