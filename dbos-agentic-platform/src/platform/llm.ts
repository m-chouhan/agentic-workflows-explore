// Swap LLM providers here in one place rather than in each agent step.
import { google } from "@ai-sdk/google";
import { getModel } from "./config";

export function getChatModel() {
  return google(getModel() as any);
}
