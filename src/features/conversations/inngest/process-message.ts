import { createAgent, createNetwork, openai } from '@inngest/agent-kit';

// Custom Groq model wrapper for agent-kit using OpenAI adapter
const createGroqModel = (modelName: string, defaultParams?: any) => {
  console.log("[createGroqModel] Creating Groq model with:", {
    modelName,
    apiKeyPresent: !!process.env.GROQ_API_KEY,
  });
  
  try {
    const model = openai({
      model: modelName,
      apiKey: process.env.GROQ_API_KEY,
      baseUrl: 'https://api.groq.com/openai/v1',
      defaultParameters: {
        temperature: defaultParams?.temperature ?? 0.6,
        max_completion_tokens: defaultParams?.max_tokens ?? 4096,
      },
      // Add retry mechanism for rate limits
      ...(process.env.GROQ_API_KEY && {
        fetch: async (url: string, init: RequestInit) => {
          let lastError: Error | null = null;
          const maxRetries = 3;
          const baseDelay = 1000; // 1 second

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              const response = await fetch(url, init);
              
              if (response.status === 429) {
                lastError = new Error(`Rate limited, retrying... (attempt ${attempt + 1}/${maxRetries + 1})`);
                if (attempt < maxRetries) {
                  const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
                  console.log(`[groq] Rate limited, waiting ${delay}ms before retry...`);
                  await new Promise(resolve => setTimeout(resolve, delay));
                  continue;
                }
              }
              
              return response;
            } catch (error) {
              lastError = error instanceof Error ? error : new Error(String(error));
              if (attempt < maxRetries) {
                const delay = baseDelay * Math.pow(2, attempt);
                console.log(`[groq] Request failed, retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
              }
            }
          }
          
          throw lastError || new Error('Unknown error');
        },
      }),
    });
    
    console.log("[createGroqModel] Model created successfully");
    return model;
  } catch (error) {
    console.error("[createGroqModel] Error creating model:", error);
    throw error;
  }
};

import { inngest } from "@/inngest/client";
import { Id } from "../../../../convex/_generated/dataModel";
import { NonRetriableError } from "inngest";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../convex/_generated/api";
import {
  CODING_AGENT_SYSTEM_PROMPT,
  TITLE_GENERATOR_SYSTEM_PROMPT
} from "./constants";
import { DEFAULT_CONVERSATION_TITLE } from "../constants";
import { createReadFilesTool } from './tools/read-files';
import { createListFilesTool } from './tools/list-files';
import { createUpdateFileTool } from './tools/update-file';
import { createCreateFilesTool } from './tools/create-files';
import { createCreateFolderTool } from './tools/create-folder';
import { createRenameFileTool } from './tools/rename-file';
import { createDeleteFilesTool } from './tools/delete-files';
import { createScrapeUrlsTool } from './tools/scrape-urls';

interface MessageEvent {
  messageId: Id<"messages">;
  conversationId: Id<"conversations">;
  projectId: Id<"projects">;
  message: string;
}

export const processMessage = inngest.createFunction(
  {
    id: "process-message",
    cancelOn: [
      {
        event: "message/cancel",
        if: "event.data.messageId == async.data.messageId",
      },
    ],
    onFailure: async ({ event, step }) => {
      const { messageId } = event.data.event.data as MessageEvent;
      const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;

      if (internalKey) {
        await step.run("update-message-on-failure", async () => {
          await convex.mutation(api.system.updateMessageContent, {
            internalKey,
            messageId,
            content:
              "My apologies, I encountered an error while processing your request. Let me know if you need anything else!",
          });
        });
      }
    },
  },
  {
    event: "message/sent",
  },
  async ({ event, step }) => {
    const {
      messageId,
      conversationId,
      projectId,
      message,
    } = event.data as MessageEvent;

    const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;

    if (!internalKey) {
      throw new NonRetriableError("POLARIS_CONVEX_INTERNAL_KEY is not configured");
    }

    await step.sleep("wait-for-db-sync", "1s");

    // Get conversation for title generation check
    const conversation = await step.run("get-conversation", async () => {
      return await convex.query(api.system.getConversationById, {
        internalKey,
        conversationId,
      });
    });

    if (!conversation) {
      throw new NonRetriableError("Conversation not found");
    }

    // Fetch recent messages for conversation context
    const recentMessages = await step.run("get-recent-messages", async () => {
      return await convex.query(api.system.getRecentMessages, {
        internalKey,
        conversationId,
        limit: 10,
      });
    });

    // Build system prompt with conversation history (exclude the current processing message)
    let systemPrompt = CODING_AGENT_SYSTEM_PROMPT;

    const contextMessages = recentMessages.filter(
      (msg) => msg._id !== messageId && msg.content.trim() !== ""
    );

    if (contextMessages.length > 0) {
      const historyText = contextMessages
        .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
        .join("\n\n");

      systemPrompt += `\n\n## Previous Conversation (for context only - do NOT repeat these responses):\n${historyText}\n\n## Current Request:\nRespond ONLY to the user's new message below. Do not repeat or reference your previous responses.`;
    }

    // Generate conversation title if it's still the default
    const shouldGenerateTitle = conversation.title === DEFAULT_CONVERSATION_TITLE;

    if (shouldGenerateTitle) {
      const titleAgent = createAgent({
        name: "title-generator",
        system: TITLE_GENERATOR_SYSTEM_PROMPT,
        model: createGroqModel('llama-3.1-8b-instant'),
      });

      const { output } = await titleAgent.run(message, { step });

      const textMessage = output.find(
        (m) => m.type === "text" && m.role === "assistant"
      );

      if (textMessage?.type === "text") {
        const title =
          typeof textMessage.content === "string"
            ? textMessage.content.trim()
            : textMessage.content.map((c) => c.text).join("").trim();

        if (title) {
          await step.run("update-conversation-title", async () => {
            await convex.mutation(api.system.updateConversationTitle, {
              internalKey,
              conversationId,
              title,
            });
          });
        }
      }
    }

    // Create the coding agent with file tools
    const codingAgent = createAgent({
      name: "polaris",
      description: "An expert AI coding assistant",
      system: systemPrompt,
      // Use a model with strong tool-use support
      model: createGroqModel('llama-3.1-8b-instant'),
      tools: [
        createListFilesTool({ internalKey, projectId }),
        createReadFilesTool({ internalKey }),
        createUpdateFileTool({ internalKey }),
        createCreateFilesTool({ projectId, internalKey }),
        createCreateFolderTool({ projectId, internalKey }),
        createRenameFileTool({ internalKey }),
        createDeleteFilesTool({ internalKey }),
        createScrapeUrlsTool(),
      ],
    });

    // Create network with single agent
    const network = createNetwork({
      name: "polaris-network",
      agents: [codingAgent],
      maxIter: 10,
      router: ({ network }) => {
        const results = network.state.results;

        // Always allow at least 2 iterations (one for tool calls, one for response)
        if (results.length < 2) {
          return codingAgent;
        }

        const lastResult = results.at(-1);
        const hasTextResponse = lastResult?.output.some(
          (m) => m.type === "text" && m.role === "assistant"
        );
        const hasToolCalls = lastResult?.output.some(
          (m) => m.type === "tool_call"
        );

        // If we have a text response and no tool calls, we're done
        if (hasTextResponse && !hasToolCalls) {
          return undefined;
        }

        // Safety: Stop after maxIter to prevent infinite loops
        if (results.length >= 20) {
          return undefined;
        }

        // Otherwise continue
        return codingAgent;
      },
    });

    // Run the agent
    console.log("[process-message] Starting agent execution...");
    const result = await network.run(message);

    // Debug: log all results to help trace issues
    console.log("[process-message] Total iterations:", result.state.results.length);
    console.log("[process-message] All results:", JSON.stringify(result.state.results.map(r => r.output.map(m => ({ type: m.type, role: m.role, contentLength: typeof (m as any).content === 'string' ? (m as any).content.length : 'array' }))), null, 2));

    // Extract the assistant's text response from the last agent result
    const lastResult = result.state.results.at(-1);
    const textMessage = lastResult?.output.find(
      (m) => m.type === "text" && m.role === "assistant"
    );

    let assistantResponse =
      "I processed your request. Let me know if you need anything else!";

    if (textMessage?.type === "text") {
      assistantResponse =
        typeof textMessage.content === "string"
          ? textMessage.content
          : textMessage.content.map((c) => c.text).join("");
    }

    // Update the assistant message with the response
    await step.run("update-assistant-message", async () => {
      await convex.mutation(api.system.updateMessageContent, {
        internalKey,
        messageId,
        content: assistantResponse,
      });
    });

    return { success: true, messageId, conversationId };
  }
);