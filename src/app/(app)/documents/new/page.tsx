import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { fullName } from '@/lib/format';
import { Callout, Card, CardBody, PageHeader } from '@/components/ui';
import { UploadForm } from './upload-form';

export const metadata: Metadata = { title: 'Upload document' };

export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ workerId?: string }>;
}) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'docs.write');
  const params = await searchParams;

  const workers = await db.worker.findMany({
    where: { deletedAt: null },
    select: { id: true, legalFirstName: true, preferredName: true, lastName: true },
    orderBy: { lastName: 'asc' },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        breadcrumbs={[{ label: 'Documents', href: '/documents' }, { label: 'Upload' }]}
        title="Upload a document"
      />
      <Callout tone="info">
        Legal forms and templates must be version-controlled with a named approver. FSW People never invents legal
        language — upload documents that HR/legal has approved, and record who approved them.
      </Callout>
      <Card className="mt-4">
        <CardBody>
          <UploadForm
            workers={workers.map((w) => ({ value: w.id, label: fullName(w) }))}
            preselectWorkerId={params.workerId}
          />
        </CardBody>
      </Card>
    </div>
  );
}
