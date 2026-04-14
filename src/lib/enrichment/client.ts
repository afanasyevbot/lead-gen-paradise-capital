import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Read the API key directly from .env.local as a fallback.
 * Next.js doesn't always expose .env.local vars to detached async contexts.
 */
function loadApiKey(): string {
  // Try process.env first (works in production and most dev contexts)
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }

  // Fallback: read .env.local directly
  try {
    const envPath = resolve(process.cwd(), ".env.local");
    const content = readFileSync(envPath, "utf-8");
    const match = content.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (match) {
      const key = match[1].trim();
      // Cache it in process.env for subsequent calls
      process.env.ANTHROPIC_API_KEY = key;
      return key;
    }
  } catch {
    // .env.local doesn't exist (production)
  }

  throw new Error(
    "ANTHROPIC_API_KEY not found. Set it in .env.local or as an environment variable."
  );
}

/**
 * Create an Anthropic client with explicit API key.
 * Reads from process.env first, falls back to .env.local file.
 */
export function createAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: loadApiKey() });
}
