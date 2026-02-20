import { createOpenAI } from "@ai-sdk/openai";

export const openRouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

export const defaultModel = openRouter("anthropic/claude-3.5-sonnet");
export const fastModel = openRouter("google/gemini-2.0-flash-001");
