import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  TextAIProvider,
  TextGenerationRequest,
  TextGenerationResult,
} from "@/lib/ai/types";

/**
 * Anthropic text adapter.
 *
 * Only this file imports the Anthropic SDK. Domain code sees TextAIProvider.
 */
export class AnthropicTextProvider implements TextAIProvider {
  readonly key = "anthropic";
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
  }

  async generate(request: TextGenerationRequest): Promise<TextGenerationResult> {
    const system = request.jsonSchemaHint
      ? `${request.system ?? ""}\n\nRespond with valid JSON only, matching this shape:\n${request.jsonSchemaHint}\nDo not wrap the JSON in markdown fences.`.trim()
      : request.system;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.4,
      ...(system ? { system } : {}),
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      text,
      model: response.model,
      provider: this.key,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason ?? undefined,
    };
  }

  async stream(
    request: TextGenerationRequest,
    onDelta: (chunk: string) => void,
  ): Promise<TextGenerationResult> {
    const system = request.system;
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.4,
      ...(system ? { system } : {}),
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    stream.on("text", onDelta);
    const final = await stream.finalMessage();

    const text = final.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      text,
      model: final.model,
      provider: this.key,
      inputTokens: final.usage.input_tokens,
      outputTokens: final.usage.output_tokens,
      stopReason: final.stop_reason ?? undefined,
    };
  }
}
