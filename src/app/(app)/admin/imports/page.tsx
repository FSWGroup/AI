import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { IMPORT_KINDS } from '@/lib/imports';
import { fmtDateTime, humanize } from '@/lib/format';
import { Callout, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge, Table, THead, TH, TRow, TD } from '@/components/ui';
import { ImportWizard } from './import-wizard';

export const metadata: Metadata = { title: 'Import center' };

export default async function ImportsPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'imports.admin');

  const jobs = await db.importJob.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });

  return (
    <div>
      <PageHeader
        title="Import center"
        description="Upload → map → preview → validate → confirm. Nothing is written until you confirm, and a bad row is skipped rather than corrupting the batch."
      />
      <Callout tone="info">
        CSV only, UTF-8, max 5 MB. Column names must match exactly — each import type lists its required and optional
        columns below.
      </Callout>

      <div className="mt-4 space-y-4">
        <Card>
          <CardHeader title="New import" />
          <CardBody>
            <ImportWizard
              kinds={Object.entries(IMPORT_KINDS).map(([key, spec]) => ({
                key,
                label: spec.label,
                required: [...spec.required],
                optional: [...spec.optional],
              }))}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Import history" />
          {jobs.length === 0 ? (
            <EmptyState title="No imports yet" />
          ) : (
            <Table>
              <THead><TH>File</TH><TH>Type</TH><TH>Rows</TH><TH>Imported</TH><TH>Errors</TH><TH>When</TH><TH>Status</TH></THead>
              <tbody>
                {jobs.map((j) => (
                  <TRow key={j.id}>
                    <TD className="font-medium">{j.fileName}</TD>
                    <TD>{humanize(j.kind)}</TD>
                    <TD>{j.totalRows}</TD>
                    <TD className="text-ok-500">{j.successRows}</TD>
                    <TD className={j.errorRows > 0 ? 'text-danger-500' : ''}>{j.errorRows}</TD>
                    <TD className="whitespace-nowrap">{fmtDateTime(j.createdAt)}</TD>
                    <TD><StatusBadge status={j.status} /></TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
