import "server-only";
import {
  CapabilityUnavailableError,
  type EmbeddingProvider,
  type ImageProvider,
  type TTSProvider,
  type TextAIProvider,
} from "@/lib/ai/types";
import { AnthropicTextProvider } from "@/lib/ai/providers/anthropic";
import {
  OpenAIEmbeddingProvider,
  OpenAIImageProvider,
  OpenAITTSProvider,
  OpenAITextProvider,
} from "@/lib/ai/providers/openai";

/**
 * Provider resolution.
 *
 * Selection order is deliberate: Anthropic first for text (per FSW preference),
 * OpenAI for embeddings/TTS/images. Everything is optional — callers must
 * handle a null provider or catch CapabilityUnavailableError.
 */

let textProvider: TextAIProvider | null | undefined;
let embeddingProvider: EmbeddingProvider | null | undefined;
let ttsProvider: TTSProvider | null | undefined;
let imageProvider: ImageProvider | null | undefined;

export function getTextProvider(): TextAIProvider | null {
  if (textProvider !== undefined) return textProvider;

  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) {
    textProvider = new AnthropicTextProvider(anthropicKey);
    return textProvider;
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    textProvider = new OpenAITextProvider(openaiKey);
    return textProvider;
  }

  textProvider = null;
  return null;
}

export function requireTextProvider(): TextAIProvider {
  const provider = getTextProvider();
  if (!provider) {
    throw new CapabilityUnavailableError(
      "AI text generation",
      "Set ANTHROPIC_API_KEY (preferred) or OPENAI_API_KEY in the environment, then reload Admin → Integrations.",
    );
  }
  return provider;
}

export function getEmbeddingProvider(): EmbeddingProvider | null {
  if (embeddingProvider !== undefined) return embeddingProvider;

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    embeddingProvider = new OpenAIEmbeddingProvider(openaiKey);
    return embeddingProvider;
  }

  embeddingProvider = null;
  return null;
}

export function getTTSProvider(): TTSProvider | null {
  if (ttsProvider !== undefined) return ttsProvider;

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    ttsProvider = new OpenAITTSProvider(openaiKey);
    return ttsProvider;
  }

  ttsProvider = null;
  return null;
}

export function getImageProvider(): ImageProvider | null {
  if (imageProvider !== undefined) return imageProvider;

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    imageProvider = new OpenAIImageProvider(openaiKey);
    return imageProvider;
  }

  imageProvider = null;
  return null;
}

/** Test seam: reset memoized providers after mutating environment variables. */
export function __resetProviderCache(): void {
  textProvider = undefined;
  embeddingProvider = undefined;
  ttsProvider = undefined;
  imageProvider = undefined;
}

/**
 * Parse a JSON object out of a model response, tolerating markdown fences and
 * leading prose. Returns null rather than throwing so callers can degrade.
 */
export function parseJsonResponse<T>(text: string): T | null {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Fall back to the outermost balanced {...} or [...] block.
    const start = candidate.search(/[{[]/);
    if (start === -1) return null;
    const opener = candidate[start];
    const closer = opener === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < candidate.length; i += 1) {
      const char = candidate[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === opener) depth += 1;
      else if (char === closer) {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(candidate.slice(start, i + 1)) as T;
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}
