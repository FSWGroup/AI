import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission, can } from '@/lib/authz';
import { fmtDate, fullName } from '@/lib/format';
import {
  Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard,
  Table, TD, TH, THead, TRow,
} from '@/components/ui';
import { skillCoverage, expiringCertifications, certificationState, SKILL_LEVELS } from '@/lib/skills';
import { AddSkillButton } from './skills-ui';

export const metadata: Metadata = { title: 'Skills' };
export const dynamic = 'force-dynamic';

const RISK_TONE = { UNCOVERED: 'red', SINGLE_POINT: 'red', THIN: 'amber', NONE: 'gray' } as const;
const RISK_LABEL = {
  UNCOVERED: 'nobody covers this',
  SINGLE_POINT: 'one person deep',
  THIN: 'two people deep',
  NONE: '',
} as const;

export default async function SkillsPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'skills.read');
  const isAdmin = can(ctx, 'skills.admin');

  const [coverage, expiring, skills] = await Promise.all([
    skillCoverage(),
    expiringCertifications(),
    db.skill.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
  ]);

  const atRisk = coverage.filter((c) => c.risk !== 'NONE');
  const expiredCount = expiring.filter((e) => certificationState(e.expiresAt) === 'EXPIRED').length;

  return (
    <div>
      <PageHeader
        title="Skills & certifications"
        description="What people can actually do, which credentials are current, and where we are one person deep."
        actions={isAdmin ? <AddSkillButton /> : undefined}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Skills tracked" value={skills.filter((s) => s.active).length} />
        <StatCard label="Critical skills at risk" value={atRisk.length} tone={atRisk.length > 0 ? 'danger' : 'default'} />
        <StatCard label="Certifications lapsing soon" value={expiring.length - expiredCount} tone={expiring.length - expiredCount > 0 ? 'warn' : 'default'} />
        <StatCard label="Certifications expired" value={expiredCount} tone={expiredCount > 0 ? 'danger' : 'default'} />
      </div>

      <Card className="mb-4">
        <CardHeader
          title="Coverage risk"
          description="Only skills marked critical appear here. A holder counts if they are at Proficient or above, verified, and not lapsed."
        />
        <CardBody>
          {atRisk.length === 0 ? (
            <EmptyState
              title="No critical skill is thin right now"
              description="Mark a skill critical when work stops without it, and it will be watched here."
            />
          ) : (
            <Table>
              <THead>
                <TH>Skill</TH>
                <TH>Risk</TH>
                <TH>Covered by</TH>
                <TH>Recorded</TH>
                <TH>Lapsing</TH>
              </THead>
              <tbody>
                {atRisk.map((row) => (
                  <TRow key={row.skillId}>
                    <TD>
                      <span className="font-medium text-ink-900">{row.skillName}</span>
                      <span className="ml-2 text-[12px] text-ink-400">{row.category.toLowerCase()}</span>
                    </TD>
                    <TD><Badge tone={RISK_TONE[row.risk]}>{RISK_LABEL[row.risk]}</Badge></TD>
                    <TD className="tabular-nums">{row.coveredBy}</TD>
                    <TD className="tabular-nums">{row.claimedBy}</TD>
                    <TD className="tabular-nums">
                      {row.expiringSoon > 0 ? `${row.expiringSoon} soon` : ''}
                      {row.expired > 0 ? `${row.expiringSoon > 0 ? ', ' : ''}${row.expired} expired` : ''}
                      {row.expiringSoon === 0 && row.expired === 0 ? '—' : ''}
                    </TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader title={`Certifications to renew (${expiring.length})`} description="Inside 60 days, or already lapsed." />
        <CardBody>
          {expiring.length === 0 ? (
            <EmptyState title="Nothing lapsing" description="No certification expires in the next 60 days." />
          ) : (
            <Table>
              <THead>
                <TH>Person</TH>
                <TH>Certification</TH>
                <TH>Status</TH>
                <TH>Expires</TH>
              </THead>
              <tbody>
                {expiring.map((row) => {
                  const state = certificationState(row.expiresAt);
                  return (
                    <TRow key={row.id}>
                      <TD>
                        <Link href={`/people/${row.workerId}`} className="text-ink-900 hover:text-brand-600">
                          {fullName(row.worker)}
                        </Link>
                      </TD>
                      <TD>
                        {row.skill.name}
                        {row.skill.isCritical ? <Badge tone="red">critical</Badge> : null}
                      </TD>
                      <TD>
                        <Badge tone={state === 'EXPIRED' ? 'red' : 'amber'}>
                          {state === 'EXPIRED' ? 'expired' : 'expiring'}
                        </Badge>
                      </TD>
                      <TD>{fmtDate(row.expiresAt)}</TD>
                    </TRow>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Skill catalog" description="Levels run 1 Aware · 2 Working · 3 Proficient · 4 Expert · 5 Can teach it." />
        <CardBody>
          {skills.length === 0 ? (
            <EmptyState
              title="No skills defined yet"
              description="Start with the ones that stop work when nobody has them: forklift, OSHA, CDL, the ERP."
              action={isAdmin ? <AddSkillButton /> : undefined}
            />
          ) : (
            <Table>
              <THead>
                <TH>Skill</TH>
                <TH>Category</TH>
                <TH>Type</TH>
                <TH>Covered by</TH>
                {isAdmin ? <TH /> : null}
              </THead>
              <tbody>
                {skills.map((skill) => {
                  const cov = coverage.find((c) => c.skillId === skill.id);
                  return (
                    <TRow key={skill.id} className={skill.active ? undefined : 'opacity-50'}>
                      <TD>
                        <span className="font-medium text-ink-900">{skill.name}</span>
                        {skill.isCritical ? <Badge tone="red">critical</Badge> : null}
                        {skill.description ? (
                          <span className="block text-[12px] text-ink-500">{skill.description}</span>
                        ) : null}
                      </TD>
                      <TD>{skill.category.toLowerCase()}</TD>
                      <TD>
                        {skill.isCertification
                          ? `certification${skill.validityMonths ? ` · ${skill.validityMonths}mo` : ''}`
                          : 'skill'}
                      </TD>
                      <TD className="tabular-nums">{cov?.coveredBy ?? 0}</TD>
                      {isAdmin ? (
                        <TD>
                          <AddSkillButton skill={skill} />
                        </TD>
                      ) : null}
                    </TRow>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <p className="mt-4 text-[12px] text-ink-500">
        Levels: {Object.entries(SKILL_LEVELS).map(([n, l]) => `${n} ${l}`).join(' · ')}
      </p>
    </div>
  );
}
