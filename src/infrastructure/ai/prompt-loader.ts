/**
 * Prompt Loader
 *
 * Loads AI system prompts from .prompt.md files with caching
 * and optional variable substitution. Falls back to inline
 * prompts if files can't be read (e.g., in bundled environments).
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// ─── Cache ──────────────────────────────────────────────────────────────────

const cache = new Map<string, string>();

// ─── Prompt Directory ───────────────────────────────────────────────────────

// __dirname is src/infrastructure/ai/, prompts/ is a sibling directory
const PROMPT_DIR = resolve(__dirname, "prompts");

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Load a prompt from a .prompt.md file.
 *
 * @param name - Prompt name without extension (e.g., "extract", "score").
 * @param variables - Optional key-value pairs for {{variable}} substitution.
 * @returns The prompt string with variables replaced.
 * @throws If the prompt file doesn't exist and no fallback is provided.
 *
 * @example
 * ```ts
 * const prompt = loadPrompt("extract");
 * const prompt = loadPrompt("outreach", { tier: "legacy" });
 * ```
 */
export function loadPrompt(
  name: string,
  variables?: Record<string, string>,
): string {
  let prompt = cache.get(name);

  if (!prompt) {
    const filePath = resolve(PROMPT_DIR, `${name}.prompt.md`);
    prompt = readFileSync(filePath, "utf-8");
    cache.set(name, prompt);
  }

  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      prompt = prompt.replaceAll(`{{${key}}}`, value);
    }
  }

  return prompt;
}

/**
 * Load a prompt, falling back to an inline string if the file can't be read.
 * Useful during the migration period while prompts exist in both places.
 *
 * @param name - Prompt name without extension.
 * @param fallback - Inline prompt string to use if the file can't be read.
 * @param variables - Optional key-value pairs for {{variable}} substitution.
 */
export function loadPromptWithFallback(
  name: string,
  fallback: string,
  variables?: Record<string, string>,
): string {
  try {
    return loadPrompt(name, variables);
  } catch {
    // File not found or not readable — use the inline fallback.
    let prompt = fallback;
    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        prompt = prompt.replaceAll(`{{${key}}}`, value);
      }
    }
    return prompt;
  }
}

/**
 * Clear the prompt cache. Useful for testing or hot-reloading prompts.
 */
export function clearPromptCache(): void {
  cache.clear();
}

/**
 * Check if a prompt file exists and is readable.
 */
export function promptExists(name: string): boolean {
  try {
    const filePath = resolve(PROMPT_DIR, `${name}.prompt.md`);
    readFileSync(filePath, "utf-8");
    return true;
  } catch {
    return false;
  }
}
