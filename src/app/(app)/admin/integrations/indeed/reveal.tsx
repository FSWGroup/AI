'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { revealFeedUrlAction } from './actions';

/** Show the tokenised feed URL only on request; the reveal is audited. */
export function RevealFeedUrl() {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (url) {
    return (
      <code className="block break-all rounded bg-ink-50 px-3 py-2 font-mono text-[12px] text-ink-900">{url}</code>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const result = await revealFeedUrlAction();
          setBusy(false);
          if (result.error) setError(result.error);
          else setUrl(result.url ?? null);
        }}
      >
        {busy ? 'Revealing…' : 'Reveal feed URL'}
      </Button>
      {error ? <span className="text-[12px] text-danger-500">{error}</span> : null}
    </span>
  );
}
