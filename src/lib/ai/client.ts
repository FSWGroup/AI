import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';

/**
 * The single place FSW People talks to an external model (§35).
 *
 * Rules that hold everywhere AI is used in this product:
 *
 *  - The AI runs *after* an authorization check, on data the calling user is
 *    already entitled to see. It has no credentials of its own and cannot
 *    read anything the user could not read.
 *  - Nothing is sent that the task does not need. Callers pass the specific
 *    fields, redacted; never a whole personnel record.
 *  - Output is advisory. No AI result changes a protected HR record, and no
 *    AI result rejects, hires, pays or terminates anyone.
 *  - Without ANTHROPIC_API_KEY the feature is simply off — the UI says so
 *    rather than showing a control that fails.
 */

export function aiEnabled(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export function aiModel(): string {
  return env.AI_MODEL;
}

let client: Anthropic | null = null;

export function aiClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AiUnavailableError(
      'AI features are not configured. An administrator sets ANTHROPIC_API_KEY — see Admin › Integrations.',
    );
  }
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
  return client;
}

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

/** Turn SDK failures into something a recruiter can act on. */
export function describeAiError(error: unknown): string {
  if (error instanceof AiUnavailableError) return error.message;
  if (error instanceof Anthropic.RateLimitError) {
    return 'The AI service is rate limited right now. Try again in a minute.';
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return 'The AI service rejected our credentials. An administrator should check ANTHROPIC_API_KEY.';
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the AI service. Check outbound network access and try again.';
  }
  if (error instanceof Anthropic.APIError) {
    return `The AI service returned an error (${error.status ?? 'unknown'}). Nothing was saved.`;
  }
  return 'The AI service did not return usable suggestions. Nothing was saved.';
}
