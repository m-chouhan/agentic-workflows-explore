/**
 * LLM model factory — centralises the provider/model choice so workflow
 * agents don't each hard-code it. Swap providers here in one place.
 */
import { google } from "@ai-sdk/google";
import { getModel } from "./config";

/** The configured chat model for agentic steps (Gemini via the Vercel AI SDK). */
export function getChatModel() {
  return google(getModel() as any);
}
