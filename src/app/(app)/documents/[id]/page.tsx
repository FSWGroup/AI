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
import { esignConfigured } from '@/lib/esign';
import {
  RequestSignatureButton, SignNowButton, CertificateButton,
  StatusBadgeForSignature, CancelSignatureButton,
} from '../signature-ui';

export const metadata: Metadata = { title: 'Document' };

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;

  const doc = await db.document.findUnique({
    where: { id },
    include: {
      worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
      versions: {
        orderBy: { version: 'desc' },
        include: {
          signatures: { include: { worker: { select: { legalFirstName: true, preferredName: true, lastName: true } } } },
          signatureRequests: {
            include: { worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } } },
            orderBy: { createdAt: 'desc' },
          },
        },
      },
    },
  });
  if (!doc || doc.deletedAt) notFound();
  if (!(await canAccessDocument(ctx, doc))) notFound();

  const latest = doc.versions[0];
  const isOwner = doc.workerId !== null && doc.workerId === ctx.workerId;
  const alreadySigned = latest?.signatures.some((s) => s.workerId === ctx.workerId);
  const canSign = isOwner && doc.requiresSignature && !alreadySigned;

  // Certified signature requests across every version, newest first.
  const signatureRequests = doc.versions.flatMap((v) => v.signatureRequests);
  const myOpenRequest = signatureRequests.find(
    (r) => r.workerId === ctx.workerId && ['SENT', 'VIEWED'].includes(r.status),
  );
  const canRequest = can(ctx, 'docs.write') && latest?.mimeType === 'application/pdf';
  const signerCandidates = canRequest
    ? await db.worker.findMany({
        where: { status: { in: ['ACTIVE', 'ONBOARDING', 'ON_LEAVE'] }, deletedAt: null },
        select: {
          id: true, legalFirstName: true, preferredName: true, lastName: true,
          workEmail: true, personalEmail: true,
        },
        orderBy: { lastName: 'asc' },
      })
    : [];

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

        {myOpenRequest ? (
          <Card>
            <CardHeader
              title="You have been asked to sign this"
              description="Opens a signing session with the provider. The link is issued to you and expires shortly."
            />
            <CardBody>
              <SignNowButton requestId={myOpenRequest.id} />
              {myOpenRequest.dueAt ? (
                <p className="mt-2 text-[12px] text-ink-500">Due by {fmtDate(myOpenRequest.dueAt)}.</p>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        {can(ctx, 'docs.write') || signatureRequests.length > 0 ? (
          <Card>
            <CardHeader
              title="Certified signatures"
              description="A tamper-evident signature from the signing provider, with its audit certificate stored alongside."
              actions={
                canRequest ? (
                  <RequestSignatureButton
                    versionId={latest!.id}
                    configured={esignConfigured()}
                    workers={signerCandidates.map((w) => ({
                      id: w.id,
                      name: fullName(w),
                      hasEmail: Boolean(w.workEmail ?? w.personalEmail),
                    }))}
                  />
                ) : undefined
              }
            />
            <CardBody>
              {latest && latest.mimeType !== 'application/pdf' && can(ctx, 'docs.write') ? (
                <p className="mb-3 text-[13px] text-ink-500">
                  Certified signature needs a PDF. This version is {latest.mimeType}.
                </p>
              ) : null}
              {signatureRequests.length === 0 ? (
                <p className="text-[13px] text-ink-500">Nothing has been sent for certified signature.</p>
              ) : (
                <ul className="space-y-2">
                  {signatureRequests.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink-100 px-3.5 py-2.5">
                      <div>
                        <span className="text-[13px] font-medium text-ink-900">{fullName(r.worker)}</span>
                        <span className="ml-2"><StatusBadgeForSignature status={r.status} /></span>
                        <span className="block text-[12px] text-ink-500">
                          requested {fmtDate(r.createdAt)}
                          {r.signedAt ? ` · signed ${fmtDate(r.signedAt)}` : ''}
                          {r.declineReason ? ` · ${r.declineReason}` : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {r.certificateFileKey ? <CertificateButton requestId={r.id} /> : null}
                        {can(ctx, 'docs.write') && ['SENT', 'VIEWED'].includes(r.status) ? (
                          <CancelSignatureButton requestId={r.id} />
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        ) : null}

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
