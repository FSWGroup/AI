/**
 * AI provider interfaces.
 *
 * Domain code depends only on these types. Concrete adapters live in
 * src/lib/ai/providers/* and are selected at runtime by src/lib/ai/index.ts
 * based on configured environment variables.
 *
 * This is what keeps FSW Academy from being welded to a single vendor.
 */

export interface TextMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TextGenerationRequest {
  system?: string;
  messages: TextMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Ask the provider for JSON matching this description; adapters may hint the model. */
  jsonSchemaHint?: string;
}

export interface TextGenerationResult {
  text: string;
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  stopReason?: string;
}

export interface TextAIProvider {
  readonly key: string;
  readonly model: string;
  generate(request: TextGenerationRequest): Promise<TextGenerationResult>;
  /** Streaming variant for chat surfaces. Falls back to generate() when unsupported. */
  stream?(
    request: TextGenerationRequest,
    onDelta: (chunk: string) => void,
  ): Promise<TextGenerationResult>;
}

export interface EmbeddingProvider {
  readonly key: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface TTSRequest {
  text: string;
  voice?: string;
  speed?: number;
  language?: string;
}

export interface TTSResult {
  audio: Buffer;
  mimeType: string;
  durationSeconds?: number;
  provider: string;
}

export interface TTSProvider {
  readonly key: string;
  readonly voices: { id: string; label: string; language: string }[];
  synthesize(request: TTSRequest): Promise<TTSResult>;
}

export interface ImageGenerationRequest {
  prompt: string;
  width?: number;
  height?: number;
}

export interface ImageResult {
  image: Buffer;
  mimeType: string;
  provider: string;
}

export interface ImageProvider {
  readonly key: string;
  generate(request: ImageGenerationRequest): Promise<ImageResult>;
}

/** A single storyboard scene handed to a video provider. */
export interface VideoScene {
  index: number;
  title: string;
  /** Spoken narration for this scene. */
  narration: string;
  /** Short on-screen text (headline / bullet lines). */
  onScreenText: string[];
  /** Optional visual direction: "diagram", "screenshot", "callout", "steps". */
  visualStyle?: string;
  /** Media asset to display, when the author attached one. */
  mediaId?: string;
  estimatedSeconds: number;
}

export interface VideoRenderRequest {
  jobId: string;
  title: string;
  mode: string;
  scenes: VideoScene[];
  aspectRatio: "16:9" | "9:16" | "1:1";
  language: string;
  voice?: string;
  /** Brand values resolved from settings, so providers never read settings directly. */
  brand: {
    appName: string;
    companyName: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    logoPath?: string;
    introPath?: string;
    outroPath?: string;
  };
  /** Caption cues, already timed by the pipeline. */
  captions?: { startSeconds: number; endSeconds: number; text: string }[];
  /** Narration audio per scene, when TTS is available. */
  narrationAudio?: { sceneIndex: number; path: string; durationSeconds: number }[];
}

export interface VideoRenderResult {
  /** Absolute path to the rendered MP4 on the local filesystem. */
  outputPath: string;
  durationSeconds: number;
  provider: string;
  captionsVtt?: string;
}

export interface VideoProvider {
  readonly key: string;
  readonly label: string;
  /** Modes this provider can render. */
  readonly supportedModes: string[];
  /** True when credentials/binaries for this provider are present. */
  isAvailable(): boolean;
  render(request: VideoRenderRequest): Promise<VideoRenderResult>;
}

/** Raised when an AI capability is requested but not configured. */
export class CapabilityUnavailableError extends Error {
  readonly capability: string;
  constructor(capability: string, guidance: string) {
    super(`${capability} is not configured. ${guidance}`);
    this.name = "CapabilityUnavailableError";
    this.capability = capability;
  }
}
