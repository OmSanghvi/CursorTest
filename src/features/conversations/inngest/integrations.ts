import { inngest } from "@/inngest/client";
import { defaultModel } from "@/lib/open-router";
import { generateText } from "ai";

// Slack Integration
export const processSlackMessage = inngest.createFunction(
  { id: "slack-message-handler" },
  { event: "integration/slack/message" },
  async ({ event, step }) => {
    const { text, channel, user } = event.data as { text: string; channel: string; user: string };

    // Here we can call the coding agent or just respond
    // For now, let's respond with something
    const response = await step.run("generate-response", async () => {
      const { text: result } = await generateText({
        model: defaultModel,
        system: "You are an AI assistant integrated with Slack. Provide helpful coding advice.",
        prompt: text,
      });
      return result;
    });

    // Send back to Slack (requires SLACK_BOT_TOKEN)
    await step.run("send-to-slack", async () => {
      const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
      if (!SLACK_BOT_TOKEN) return { success: false, error: "SLACK_BOT_TOKEN not configured" };

      const resp = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        },
        body: JSON.stringify({
          channel,
          text: response,
        }),
      });

      return await resp.json();
    });
  }
);
