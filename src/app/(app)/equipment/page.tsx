import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { fmtDate, fmtMoney, fullName, humanize } from '@/lib/format';
import { Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge, Table, THead, TH, TRow, TD } from '@/components/ui';
import { SearchBox, FilterSelect } from '@/components/ui/client';
import { AssetForm, AssignAssetForm, ReturnForm } from './equipment-forms';

export const metadata: Metadata = { title: 'Equipment' };

export default async function EquipmentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'equipment.admin');
  const params = await searchParams;

  const [assets, workers] = await Promise.all([
    db.equipmentAsset.findMany({
      where: {
        ...(params.q
          ? {
              OR: [
                { assetTag: { contains: params.q, mode: 'insensitive' } },
                { serialNumber: { contains: params.q, mode: 'insensitive' } },
                { model: { contains: params.q, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(params.status ? { status: params.status } : {}),
      },
      orderBy: { assetTag: 'asc' },
      include: {
        assignments: {
          where: { returnedAt: null },
          take: 1,
          include: { worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } } },
        },
      },
    }),
    db.worker.findMany({
      where: { status: { in: ['ACTIVE', 'ONBOARDING', 'PRE_START', 'OFFBOARDING'] }, deletedAt: null },
      select: { id: true, legalFirstName: true, preferredName: true, lastName: true },
      orderBy: { lastName: 'asc' },
    }),
  ]);

  const workerOptions = workers.map((w) => ({ value: w.id, label: fullName(w) }));

  return (
    <div>
      <PageHeader
        title="Equipment"
        description="Assets, assignments and returns — offboarding automatically raises return tasks."
      />
      <div className="space-y-4">
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-4 py-3">
            <SearchBox placeholder="Search tag, serial, model…" />
            <FilterSelect param="status" allLabel="All statuses" ariaLabel="Filter by status"
              options={['IN_STOCK', 'ASSIGNED', 'IN_REPAIR', 'RETIRED', 'LOST'].map((s) => ({ value: s, label: humanize(s) }))} />
          </div>
          {assets.length === 0 ? (
            <EmptyState title="No assets" description="Add company equipment below to start tracking it." />
          ) : (
            <Table>
              <THead><TH>Asset</TH><TH>Tag / Serial</TH><TH>Value</TH><TH>Condition</TH><TH>Assigned to</TH><TH>Status</TH><TH></TH></THead>
              <tbody>
                {assets.map((a) => {
                  const current = a.assignments[0];
                  return (
                    <TRow key={a.id}>
                      <TD className="font-medium">{humanize(a.kind)} — {a.make} {a.model}</TD>
                      <TD>{a.assetTag}<span className="block text-[12px] text-ink-400">{a.serialNumber ?? ''}</span></TD>
                      <TD className="tabular-nums">{a.valueUsd ? fmtMoney(Number(a.valueUsd)) : '—'}</TD>
                      <TD>{humanize(a.condition)}</TD>
                      <TD>
                        {current ? (
                          <Link href={`/people/${current.worker.id}?tab=assets`} className="text-ink-700 hover:text-brand-600">
                            {fullName(current.worker)}
                          </Link>
                        ) : ('—')}
                        {current?.returnDueDate ? (
                          <span className="block text-[12px] text-warn-500">return due {fmtDate(current.returnDueDate)}</span>
                        ) : null}
                      </TD>
                      <TD><StatusBadge status={a.status} /></TD>
                      <TD>
                        {current ? (
                          <ReturnForm assignmentId={current.id} />
                        ) : a.status === 'IN_STOCK' ? (
                          <AssignAssetForm assetId={a.id} workers={workerOptions} preselect={params.assign} />
                        ) : null}
                      </TD>
                    </TRow>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Add asset" />
          <CardBody>
            <AssetForm />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
