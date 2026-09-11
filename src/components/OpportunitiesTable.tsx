import { useMemo } from 'react';
import type { Opportunity } from '../types';
import { formatDate, formatLongDate } from '../utils/dates';
import { formatMoney } from '../utils/money';
import { copyTable, copyText, type CellValue } from '../utils/clipboard';
import { downloadCsv } from '../utils/csv';
import { pluralize } from '../utils/normalization';
import { CopyButton } from './CopyButton';
import { TierBadge } from './TierBadge';

export const OPPORTUNITY_HEADERS = ['Rank', 'Company', 'Sales Rep', 'Current Tier', 'Next Tier', '12M Spend', '12M Orders', 'Vendor Mix', 'Credit / Payment', 'What They Need', 'Opportunity Score'];

export function opportunityRow(o: Opportunity): CellValue[] {
  return [o.rank, o.company, o.salesRep, o.currentTier, o.nextTier, formatMoney(o.rollingSpend), o.rollingOrderCount, pluralize(o.vendorCount, 'vendor'), o.creditLabel, o.gap.summary, o.score];
}

/** Clipboard text for one salesperson, formatted like a manager's note to a rep. */
export function repSummaryText(rep: string, opportunities: Opportunity[], asOf: Date): string {
  const lines: string[] = [`${rep} — Top Customer Tier Opportunities`, `As of ${formatLongDate(asOf)}`, ''];
  if (!opportunities.length) {
    lines.push('No next-tier opportunities identified.');
    return lines.join('\n');
  }
  opportunities.forEach((o, i) => {
    lines.push(`${i + 1}. ${o.company} — ${o.currentTier} -> ${o.nextTier}`);
    lines.push(`Need: ${o.gap.summary}`);
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}

interface TableProps {
  opportunities: Opportunity[];
  showRep?: boolean;
}

export function OpportunitiesTable({ opportunities, showRep = true }: TableProps) {
  if (!opportunities.length) {
    return <p className="empty-note">No next-tier opportunities for this selection.</p>;
  }
  return (
    <div className="table-scroll">
      <table className="data-table opportunities">
        <thead>
          <tr>
            <th className="num">Rank</th>
            <th>Company</th>
            {showRep && <th>Sales Rep</th>}
            <th>Current Tier</th>
            <th>Next Tier</th>
            <th className="num">12M Spend</th>
            <th className="num">12M Orders</th>
            <th>Vendor Mix</th>
            <th>Credit / Payment</th>
            <th className="wide">What They Need</th>
            <th className="num" title="Spend progress ×45 + order progress ×25 + vendor progress ×20 + credit ×10, plus a small bonus for higher target tiers">Opportunity Score</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((o) => (
            <tr key={o.companyKey}>
              <td className="num">{o.rank}</td>
              <td className="company">{o.company}</td>
              {showRep && <td>{o.salesRep}</td>}
              <td><TierBadge tier={o.currentTier} /></td>
              <td><TierBadge tier={o.nextTier} /></td>
              <td className="num">{formatMoney(o.rollingSpend)}</td>
              <td className="num">{o.rollingOrderCount}</td>
              <td>{pluralize(o.vendorCount, 'vendor')}</td>
              <td>{o.creditLabel}</td>
              <td className="wide">{o.gap.summary}</td>
              <td className="num" title={`Spend ${Math.round(o.scoreBreakdown.spendProgress * 100)}% · Orders ${Math.round(o.scoreBreakdown.orderProgress * 100)}% · Vendors ${Math.round(o.scoreBreakdown.vendorProgress * 100)}% · Credit ${o.scoreBreakdown.creditProgress ? 'met' : 'not met'} · Bonus +${o.scoreBreakdown.bonus}${o.lastOrderDate ? ` · Last order ${formatDate(o.lastOrderDate)}` : ''}`}>{o.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface PanelProps {
  rep: string;
  opportunities: Opportunity[];
  asOf: Date;
  /** Render as a section within the All Sales Reps view. */
  grouped?: boolean;
}

export function RepOpportunitiesPanel({ rep, opportunities, asOf, grouped }: PanelProps) {
  const rows = useMemo(() => opportunities.map(opportunityRow), [opportunities]);
  return (
    <section className={`rep-panel ${grouped ? 'grouped' : ''}`}>
      <div className="panel-header">
        <h3>{rep} <span className="muted">— Top {Math.min(opportunities.length, 10) || 10}</span></h3>
        <div className="actions">
          <CopyButton label="COPY TABLE" primary onCopy={() => copyTable(OPPORTUNITY_HEADERS, rows)} title="Copy this table as tab-separated text (Excel, Sheets, Outlook, Teams)" />
          <CopyButton label="COPY SALES REP SUMMARY" onCopy={() => copyText(repSummaryText(rep, opportunities, asOf))} title="Copy a plain-text summary for this salesperson" />
          {!grouped && (
            <button type="button" className="btn btn-link" onClick={() => downloadCsv(`top-opportunities-${rep.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`, OPPORTUNITY_HEADERS, rows)}>
              Export CSV
            </button>
          )}
        </div>
      </div>
      <OpportunitiesTable opportunities={opportunities} showRep={false} />
    </section>
  );
}
