import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { humanize } from '@/lib/format';
import { Card, CardBody, CardHeader, PageHeader, Table, THead, TH, TRow, TD } from '@/components/ui';
import { TemplateForm } from '../template-form';
import { TemplateItemForm, DeleteItemButton } from './item-form';
import type { Audience } from '@/lib/audience';

export const metadata: Metadata = { title: 'Edit template' };

export default async function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'onboarding.admin');
  const { id } = await params;

  const template = await db.lifecycleTemplate.findUnique({
    where: { id },
    include: { items: { orderBy: { order: 'asc' } } },
  });
  if (!template) notFound();
  const cond = template.conditions as Audience;

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Onboarding', href: '/ops/onboarding' },
          { label: 'Templates', href: '/ops/templates' },
          { label: template.name },
        ]}
        title={template.name}
        description={`${humanize(template.kind)} template · ${template.items.length} checklist items`}
      />
      <div className="space-y-4">
        <Card>
          <CardHeader title="Template settings" />
          <CardBody>
            <TemplateForm
              template={{
                id: template.id,
                kind: template.kind,
                name: template.name,
                description: template.description,
                isDefault: template.isDefault,
                countries: cond.countries ?? [],
                workerTypes: cond.workerTypes ?? [],
              }}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Checklist items" description="Due offsets are days relative to the start date (negative = before day one)." />
          <Table>
            <THead>
              <TH>#</TH><TH>Task</TH><TH>Owner</TH><TH>Category</TH><TH>Due offset</TH><TH></TH>
            </THead>
            <tbody>
              {template.items.map((item) => (
                <TRow key={item.id}>
                  <TD>{item.order}</TD>
                  <TD>
                    <span className="font-medium">{item.title}</span>
                    {item.description ? <span className="block max-w-md truncate text-[12px] text-ink-400">{item.description}</span> : null}
                  </TD>
                  <TD>{humanize(item.ownerKind)}</TD>
                  <TD>{humanize(item.category)}</TD>
                  <TD className="tabular-nums">
                    {item.dueOffsetDays === 0 ? 'Day 1' : item.dueOffsetDays > 0 ? `+${item.dueOffsetDays}d` : `${item.dueOffsetDays}d`}
                  </TD>
                  <TD><DeleteItemButton itemId={item.id} /></TD>
                </TRow>
              ))}
            </tbody>
          </Table>
          <CardBody className="border-t border-ink-100">
            <TemplateItemForm templateId={template.id} nextOrder={(template.items.at(-1)?.order ?? 0) + 1} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
