import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export async function POST(request: Request) {
    // WhatsApp sends form-urlencoded data or JSON depending on the provider (Twilio vs Meta).
    // This example assumes a standard JSON webhook or Twilio-style form data converted to object.
    // Real-world: You'd parse `request.formData()` for Twilio or `request.json()` for Meta Cloud API.

    // For this implementation, we'll assume a JSON payload similar to what we'd expect from a standardized webhook
    let body;
    try {
        body = await request.json();
    } catch (_e) {
        // If json fails, try text/form-data parsing if needed, or just error
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Basic verification (Token verification for Meta API usually requires a GET endpoint too)
    // For the purpose of this task, we focus on the incoming message handling.

    const message = body.message || body.body; // Adapt based on actual provider
    const sender = body.from || body.sender;

    if (message && sender) {
        await inngest.send({
            name: "integration/whatsapp/message",
            data: {
                text: message,
                from: sender,
                source: "whatsapp",
            },
        });
    }

    return NextResponse.json({ status: "received" });
}

// Meta (Facebook) often requires a GET endpoint for webhook verification challenge
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("hub.mode");
    const _token = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");

    // Verify token (should be in env vars)
    // const WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN; 

    if (mode === "subscribe" && challenge) {
        // && token === WEBHOOK_VERIFY_TOKEN
        return new NextResponse(challenge);
    }

    return new NextResponse("Forbidden", { status: 403 });
}
