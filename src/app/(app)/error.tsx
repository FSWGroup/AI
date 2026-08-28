'use client';

import { useEffect } from 'react';
import { Button, Card, CardBody } from '@/components/ui';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Server logs carry the full error; the client sees only the digest.
    console.error('FSW People error digest:', error.digest);
  }, [error]);

  const isAuthz = error.message?.includes('permission') || error.name === 'AuthzError';

  return (
    <div className="mx-auto max-w-lg pt-16">
      <Card>
        <CardBody className="py-10 text-center">
          <h1 className="text-lg font-semibold text-ink-900">
            {isAuthz ? "You don't have access to this" : 'Something went wrong'}
          </h1>
          <p className="mt-2 text-sm text-ink-500">
            {isAuthz
              ? 'Ask an HR Admin if you believe you should have access.'
              : 'The error has been logged. Try again, and contact HR if it keeps happening.'}
          </p>
          {error.digest ? <p className="mt-1 text-[12px] text-ink-300">Reference: {error.digest}</p> : null}
          <div className="mt-5">
            <Button variant="secondary" onClick={reset}>
              Try again
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
