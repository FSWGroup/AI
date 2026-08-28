import 'server-only';
import { createHash } from 'crypto';
import { env } from '@/lib/env';

/**
 * For anonymous surveys, a one-way keyed hash prevents duplicate responses
 * without storing who answered (§34). The key is not reversible without
 * SESSION_SECRET, and no worker id is ever written to SurveyResponse.
 */
export function respondentKeyFor(surveyId: string, workerId: string, anonymous: boolean): string {
  return anonymous
    ? createHash('sha256').update(`${surveyId}:${workerId}:${env.SESSION_SECRET}`).digest('hex')
    : workerId;
}
