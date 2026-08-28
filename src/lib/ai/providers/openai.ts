import "server-only";
import type {
  EmbeddingProvider,
  ImageGenerationRequest,
  ImageProvider,
  ImageResult,
  TTSProvider,
  TTSRequest,
  TTSResult,
  TextAIProvider,
  TextGenerationRequest,
  TextGenerationResult,
} from "@/lib/ai/types";

/**
 * OpenAI-compatible adapters implemented over fetch.
 *
 * Written against the REST API rather than the SDK so the same adapter works
 * with any OpenAI-compatible endpoint (Azure OpenAI, a local gateway) by
 * changing OPENAI_BASE_URL.
 */

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function baseUrl(): string {
  return (process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

async function postJson<T>(path: string, apiKey: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `OpenAI request to ${path} failed (${response.status}): ${detail.slice(0, 400)}`,
    );
  }

  return (await response.json()) as T;
}

export class OpenAITextProvider implements TextAIProvider {
  readonly key = "openai";
  readonly model: string;

  constructor(private apiKey: string, model?: string) {
    this.model = model ?? process.env.OPENAI_MODEL ?? "gpt-4o";
  }

  async generate(request: TextGenerationRequest): Promise<TextGenerationResult> {
    const messages: { role: string; content: string }[] = [];
    const system = request.jsonSchemaHint
      ? `${request.system ?? ""}\n\nRespond with valid JSON only, matching this shape:\n${request.jsonSchemaHint}`.trim()
      : request.system;
    if (system) messages.push({ role: "system", content: system });
    messages.push(...request.messages.map((m) => ({ role: m.role, content: m.content })));

    const data = await postJson<{
      model: string;
      choices: { message: { content: string }; finish_reason: string }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    }>("/chat/completions", this.apiKey, {
      model: this.model,
      messages,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.4,
      ...(request.jsonSchemaHint ? { response_format: { type: "json_object" } } : {}),
    });

    return {
      text: data.choices[0]?.message.content ?? "",
      model: data.model,
      provider: this.key,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      stopReason: data.choices[0]?.finish_reason,
    };
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly key = "openai";
  readonly model: string;
  readonly dimensions = 1536;

  constructor(private apiKey: string, model?: string) {
    this.model = model ?? process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // The API accepts batches; keep them modest to stay under request limits.
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += 64) {
      batches.push(texts.slice(i, i + 64));
    }

    const vectors: number[][] = [];
    for (const batch of batches) {
      const data = await postJson<{ data: { embedding: number[]; index: number }[] }>(
        "/embeddings",
        this.apiKey,
        { model: this.model, input: batch, dimensions: this.dimensions },
      );
      const ordered = [...data.data].sort((a, b) => a.index - b.index);
      vectors.push(...ordered.map((d) => d.embedding));
    }
    return vectors;
  }
}

export class OpenAITTSProvider implements TTSProvider {
  readonly key = "openai";
  readonly voices = [
    { id: "alloy", label: "Alloy — neutral, even", language: "en" },
    { id: "echo", label: "Echo — warm, steady", language: "en" },
    { id: "fable", label: "Fable — bright, narrative", language: "en" },
    { id: "onyx", label: "Onyx — deep, authoritative", language: "en" },
    { id: "nova", label: "Nova — clear, friendly", language: "en" },
    { id: "shimmer", label: "Shimmer — light, approachable", language: "en" },
  ];

  constructor(private apiKey: string, private model = process.env.OPENAI_TTS_MODEL ?? "tts-1") {}

  async synthesize(request: TTSRequest): Promise<TTSResult> {
    const response = await fetch(`${baseUrl()}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: request.text,
        voice: request.voice ?? "onyx",
        speed: request.speed ?? 1.0,
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Speech synthesis failed (${response.status}): ${detail.slice(0, 300)}`);
    }

    return {
      audio: Buffer.from(await response.arrayBuffer()),
      mimeType: "audio/mpeg",
      provider: this.key,
    };
  }
}

export class OpenAIImageProvider implements ImageProvider {
  readonly key = "openai";

  constructor(private apiKey: string, private model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1") {}

  async generate(request: ImageGenerationRequest): Promise<ImageResult> {
    const size =
      request.width && request.height ? `${request.width}x${request.height}` : "1536x1024";

    const data = await postJson<{ data: { b64_json?: string; url?: string }[] }>(
      "/images/generations",
      this.apiKey,
      { model: this.model, prompt: request.prompt, size, n: 1 },
    );

    const first = data.data[0];
    if (first?.b64_json) {
      return {
        image: Buffer.from(first.b64_json, "base64"),
        mimeType: "image/png",
        provider: this.key,
      };
    }
    if (first?.url) {
      const img = await fetch(first.url);
      if (!img.ok) throw new Error(`Failed to download generated image (${img.status})`);
      return {
        image: Buffer.from(await img.arrayBuffer()),
        mimeType: img.headers.get("content-type") ?? "image/png",
        provider: this.key,
      };
    }
    throw new Error("Image generation returned no image data.");
  }
}
