import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { env } from '@/lib/env';
import { Badge, Callout, Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { IntegrationForm } from './integration-form';

export const metadata: Metadata = { title: 'Integrations' };

/**
 * Integration Center (§54). Adapters are declared here with the environment
 * variables they need. Credentials are NEVER stored in the database — the
 * status below is derived from environment configuration.
 */
const CATALOG = [
  { kind: 'ENTRA_ID', name: 'Microsoft Entra ID (SSO)', group: 'Microsoft', envVars: ['MS_ENTRA_TENANT_ID', 'MS_ENTRA_CLIENT_ID', 'MS_ENTRA_CLIENT_SECRET'], purpose: 'Single sign-on and future SCIM user provisioning.' },
  { kind: 'M365', name: 'Microsoft 365', group: 'Microsoft', envVars: ['MS_ENTRA_CLIENT_ID'], purpose: 'Account provisioning during onboarding, mailbox handling at offboarding.' },
  { kind: 'OUTLOOK', name: 'Outlook Calendar', group: 'Microsoft', envVars: ['MS_ENTRA_CLIENT_ID'], purpose: 'Interview scheduling and 1:1 invitations.' },
  { kind: 'TEAMS', name: 'Microsoft Teams', group: 'Microsoft', envVars: ['MS_ENTRA_CLIENT_ID'], purpose: 'Notification delivery alongside email.' },
  { kind: 'PAYROLL', name: 'Payroll provider', group: 'HR vendors', envVars: ['PAYROLL_PROVIDER', 'PAYROLL_API_KEY'], purpose: 'Push approved payroll changes to Gusto, ADP, Paychex or QuickBooks Payroll. FSW People never files taxes itself.' },
  { kind: 'BENEFITS', name: 'Benefits carrier feed', group: 'HR vendors', envVars: [], purpose: 'Enrollment feeds to carriers or a benefits administrator.' },
  { kind: 'BACKGROUND_CHECK', name: 'Background checks', group: 'HR vendors', envVars: ['BACKGROUND_CHECK_PROVIDER', 'BACKGROUND_CHECK_API_KEY'], purpose: 'Order and track pre-employment screening.' },
  { kind: 'ESIGN', name: 'DocuSign / Adobe Sign', group: 'HR vendors', envVars: ['ESIGN_PROVIDER', 'ESIGN_API_KEY'], purpose: 'For documents with statutory e-signature requirements beyond internal acknowledgment.' },
  { kind: 'PROPHET21', name: 'Prophet 21', group: 'FSW systems', envVars: [], purpose: 'ERP employee and cost-center synchronization.' },
  { kind: 'PIPEDRIVE', name: 'Pipedrive', group: 'FSW systems', envVars: [], purpose: 'Sales rep alignment and territory ownership.' },
  { kind: 'RINGCENTRAL', name: 'RingCentral', group: 'FSW systems', envVars: [], purpose: 'Extension provisioning at onboarding.' },
  { kind: 'QUICKBOOKS', name: 'QuickBooks Online', group: 'FSW systems', envVars: [], purpose: 'Contractor payment reconciliation.' },
  { kind: 'BIGCOMMERCE', name: 'BigCommerce', group: 'FSW systems', envVars: [], purpose: 'E-commerce staff account access.' },
  { kind: 'POWER_BI', name: 'Power BI', group: 'FSW systems', envVars: [], purpose: 'Workforce datasets for executive reporting.' },
  { kind: 'GDRIVE', name: 'Google Drive', group: 'FSW systems', envVars: [], purpose: 'Document handover at offboarding.' },
  { kind: 'NOTION', name: 'Notion', group: 'FSW systems', envVars: [], purpose: 'Knowledge base access provisioning.' },
];

export default async function IntegrationsPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'settings.admin');

  const configured = await db.integration.findMany();
  const groups = [...new Set(CATALOG.map((c) => c.group))];

  const envHas = (name: string) => Boolean(process.env[name]);

  return (
    <div>
      <PageHeader
        title="Integration Center"
        description="FSW People is fully usable before any of these are connected — each one adds convenience, none is required."
      />
      <Callout tone="info">
        Credentials are never stored in the database. Each adapter reads its secrets from environment variables (see
        <code> .env.example</code>), so rotating a key never requires a data migration. AI assistant:{' '}
        {env.AI_PROVIDER ? <Badge tone="green">configured</Badge> : <Badge tone="gray">not configured</Badge>}.
      </Callout>

      <div className="mt-4 space-y-4">
        {groups.map((group) => (
          <Card key={group}>
            <CardHeader title={group} />
            <CardBody>
              <ul className="space-y-3">
                {CATALOG.filter((c) => c.group === group).map((item) => {
                  const record = configured.find((i) => i.kind === item.kind);
                  const ready = item.envVars.length > 0 && item.envVars.every(envHas);
                  return (
                    <li key={item.kind} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-ink-100 px-3.5 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-ink-900">{item.name}</span>
                          {record?.enabled ? (
                            <Badge tone="green">enabled</Badge>
                          ) : ready ? (
                            <Badge tone="blue">credentials present</Badge>
                          ) : (
                            <Badge tone="gray">not configured</Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-[12.5px] text-ink-500">{item.purpose}</p>
                        {item.envVars.length > 0 ? (
                          <p className="mt-1 text-[11.5px] text-ink-400">
                            Requires: {item.envVars.map((v) => (
                              <code key={v} className={envHas(v) ? 'text-ok-500' : ''}>
                                {v}{' '}
                              </code>
                            ))}
                          </p>
                        ) : (
                          <p className="mt-1 text-[11.5px] text-ink-400">
                            Adapter scaffold — connect through the provider&apos;s API once an account is available.
                          </p>
                        )}
                      </div>
                      <IntegrationForm kind={item.kind} name={item.name} integrationId={record?.id} enabled={record?.enabled ?? false} />
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
