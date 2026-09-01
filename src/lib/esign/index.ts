import 'server-only';
import type { EsignProvider } from '@/lib/esign/types';
import { SignNowProvider } from '@/lib/esign/signnow';
import { env } from '@/lib/env';

/**
 * Provider selection. One place, so adding DocuSign or Dropbox Sign later is a
 * new adapter and one line here.
 */
let provider: EsignProvider | null = null;

export function esign(): EsignProvider {
  if (!provider) {
    switch ((env.ESIGN_PROVIDER ?? 'signnow').toLowerCase()) {
      case 'signnow':
      default:
        provider = new SignNowProvider();
    }
  }
  return provider;
}

export function esignConfigured(): boolean {
  return esign().isConfigured();
}

/** Test seam: drop the memoised provider. */
export function resetEsignProvider(): void {
  provider = null;
}

export * from '@/lib/esign/types';
