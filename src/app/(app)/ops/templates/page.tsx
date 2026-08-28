import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { humanize } from '@/lib/format';
import { Badge, Card, CardBody, CardHeader, PageHeader, Table, THead, TH, TRow, TD } from '@/components/ui';
import { TemplateForm } from './template-form';
import type { Audience } from '@/lib/audience';

export const metadata: Metadata = { title: 'Lifecycle templates' };

export default async function TemplatesPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'onboarding.admin');

  const templates = await db.lifecycleTemplate.findMany({
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { items: true, instances: true } } },
  });

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Onboarding', href: '/ops/onboarding' }, { label: 'Templates' }]}
        title="Onboarding & offboarding templates"
        description="Templates generate the task checklist for each population — country, worker type, department."
      />
      <div className="space-y-4">
        <Card>
          <Table>
            <THead>
              <TH>Template</TH><TH>Kind</TH><TH>Applies to</TH><TH>Tasks</TH><TH>Used</TH>
            </THead>
            <tbody>
              {templates.map((t) => {
                const cond = t.conditions as Audience;
                return (
                  <TRow key={t.id}>
                    <TD>
                      <Link href={`/ops/templates/${t.id}`} className="font-medium text-ink-900 hover:text-brand-600">
                        {t.name}
                      </Link>
                      {t.isDefault ? <Badge tone="blue">default</Badge> : null}
                    </TD>
                    <TD>{humanize(t.kind)}</TD>
                    <TD className="text-[13px] text-ink-500">
                      {[
                        cond.countries?.length ? `Countries: ${cond.countries.join(', ')}` : null,
                        cond.workerTypes?.length ? `Types: ${cond.workerTypes.map((w) => w.toLowerCase()).join(', ')}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Everyone'}
                    </TD>
                    <TD>{t._count.items}</TD>
                    <TD>{t._count.instances}×</TD>
                  </TRow>
                );
              })}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="New template" />
          <CardBody>
            <TemplateForm />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
