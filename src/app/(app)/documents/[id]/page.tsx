import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, can } from '@/lib/authz';
import { fmtDate, fmtDateTime, fullName, humanize } from '@/lib/format';
import { Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader } from '@/components/ui';
import { canAccessDocument } from '../actions';
import { DownloadButton, SignForm, DeleteDocButton } from './doc-ui';
import { UploadForm } from '../new/upload-form';

export const metadata: Metadata = { title: 'Document' };

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;

  const doc = await db.document.findUnique({
    where: { id },
    include: {
      worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
      versions: { orderBy: { version: 'desc' }, include: { signatures: { include: { worker: { select: { legalFirstName: true, preferredName: true, lastName: true } } } } } },
    },
  });
  if (!doc || doc.deletedAt) notFound();
  if (!(await canAccessDocument(ctx, doc))) notFound();

  const latest = doc.versions[0];
  const isOwner = doc.workerId !== null && doc.workerId === ctx.workerId;
  const alreadySigned = latest?.signatures.some((s) => s.workerId === ctx.workerId);
  const canSign = isOwner && doc.requiresSignature && !alreadySigned;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        breadcrumbs={[{ label: 'Documents', href: '/documents' }, { label: doc.title }]}
        title={doc.title}
        description={`${humanize(doc.category)} · ${doc.versions.length} version${doc.versions.length > 1 ? 's' : ''}`}
        actions={
          <span className="flex items-center gap-2">
            <Badge tone={doc.classification === 'HIGHLY_RESTRICTED' ? 'red' : doc.classification === 'CONFIDENTIAL' ? 'amber' : 'gray'}>
              {humanize(doc.classification).toLowerCase()}
            </Badge>
            {can(ctx, 'docs.write') ? <DeleteDocButton documentId={doc.id} /> : null}
          </span>
        }
      />
      <div className="space-y-4">
        <Card>
          <CardBody>
            <DescriptionList
              items={[
                {
                  label: 'Worker',
                  value: doc.worker ? (
                    <Link className="text-brand-600 hover:underline" href={`/people/${doc.worker.id}?tab=documents`}>
                      {fullName(doc.worker)}
                    </Link>
                  ) : ('Company-wide'),
                },
                { label: 'Expires', value: fmtDate(doc.expiresAt) },
                { label: 'Retention until', value: doc.retentionDate ? fmtDate(doc.retentionDate) : 'Per retention policy' },
                { label: 'Uploaded', value: fmtDate(doc.createdAt) },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Versions" description="Prior versions and their signature history are always preserved." />
          <ul className="divide-y divide-ink-100">
            {doc.versions.map((v) => (
              <li key={v.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-medium text-ink-900">
                      v{v.version} — {v.fileName}
                    </span>
                    <span className="block text-[12px] text-ink-400">
                      {(v.sizeBytes / 1024).toFixed(0)} KB · uploaded {fmtDateTime(v.createdAt)}
                      {v.approvedBy ? ` · approved by ${v.approvedBy}` : ''}
                      {v.effectiveAt ? ` · effective ${fmtDate(v.effectiveAt)}` : ''}
                    </span>
                  </div>
                  <DownloadButton versionId={v.id} />
                </div>
                {v.signatures.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {v.signatures.map((s) => (
                      <li key={s.id} className="text-[12.5px] text-ok-500">
                        ✓ {s.kind === 'SIGNATURE' ? 'Signed' : 'Acknowledged'} by {fullName(s.worker)} ({s.signedName}) ·{' '}
                        {fmtDateTime(s.signedAt)}
                        {s.ip ? ` · ${s.ip}` : ''}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>

        {canSign && latest ? (
          <Card>
            <CardHeader title="Sign this document" description="Typing your full legal name records an immutable, audited signature event bound to this exact version." />
            <CardBody>
              <SignForm versionId={latest.id} />
            </CardBody>
          </Card>
        ) : null}

        {can(ctx, 'docs.write') ? (
          <Card>
            <CardHeader title="Upload a new version" />
            <CardBody>
              <UploadForm workers={[]} documentId={doc.id} />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
