import { Fragment, useMemo, useState } from 'react';
import type { CustomerAnalysis, RankedTierCode } from '../types';
import { AT_RISK_DAYS_URGENT, AT_RISK_DAYS_WARNING } from '../config/tierRules';
import { formatDate } from '../utils/dates';
import { copyTable, type CellValue } from '../utils/clipboard';
import { downloadCsv } from '../utils/csv';
import { CopyButton } from './CopyButton';
import { CustomerDetail } from './CustomerDetail';
import { TierBadge } from './TierBadge';
import { SortHeader, useSortable } from './useSortable';

export const TIER_TABLE_HEADERS = ['Sales Rep', 'Company', 'Tier', 'Credit Criteria', 'Order Criteria', 'Spend Criteria', 'Vendor Mix Criteria', 'Falls Out Of Tier', 'Last Order Date'];

const TIER_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

export function tierTableRow(c: CustomerAnalysis): CellValue[] {
  const r = c.tier.reasons;
  return [c.metrics.salesRep, c.metrics.company, c.tier.tier, r.credit.display, r.orders.display, r.spend.display, r.vendorMix.display, formatDate(c.fallout.falloutDate), formatDate(c.metrics.lastOrderDate)];
}

export function defaultTierSort(a: CustomerAnalysis, b: CustomerAnalysis): number {
  const t = (TIER_ORDER[a.tier.tier] ?? 9) - (TIER_ORDER[b.tier.tier] ?? 9);
  if (t !== 0) return t;
  const r = a.metrics.salesRep.localeCompare(b.metrics.salesRep);
  if (r !== 0) return r;
  return a.metrics.company.localeCompare(b.metrics.company);
}

type ColKey = 'rep' | 'company' | 'tier' | 'credit' | 'orders' | 'spend' | 'vendors' | 'fallout' | 'lastOrder';

const ACCESSORS: Record<ColKey, (c: CustomerAnalysis) => string | number | Date | null> = {
  rep: (c) => c.metrics.salesRep,
  company: (c) => c.metrics.company,
  tier: (c) => TIER_ORDER[c.tier.tier] ?? 9,
  credit: (c) => c.tier.reasons.credit.display,
  orders: (c) => c.metrics.rollingOrderCount,
  spend: (c) => c.metrics.rollingSpend,
  vendors: (c) => c.metrics.vendorCount,
  fallout: (c) => c.fallout.falloutDate,
  lastOrder: (c) => c.metrics.lastOrderDate,
};

function FalloutCell({ c }: { c: CustomerAnalysis }) {
  const f = c.fallout;
  if (!f.falloutDate) return <td title={f.reason}>—</td>;
  const days = f.daysUntil ?? 0;
  const urgent = days <= AT_RISK_DAYS_URGENT;
  const warn = days <= AT_RISK_DAYS_WARNING;
  return (
    <td title={f.reason} className={urgent ? 'risk-urgent' : warn ? 'risk-warn' : ''}>
      {formatDate(f.falloutDate)}
      {warn && <span className="risk-flag" aria-label={`Falls out of tier in ${days} days`}>⚠ {days} days</span>}
    </td>
  );
}

interface Props {
  customers: CustomerAnalysis[];
  /** Customers already filtered by rep/tier/search. */
}

export function CustomerTierTable({ customers }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { sorted, sort, toggle } = useSortable<CustomerAnalysis, ColKey>(customers, ACCESSORS, defaultTierSort);
  const rows = useMemo(() => sorted.map(tierTableRow), [sorted]);

  return (
    <>
      <div className="panel-header">
        <h3>Customer Tiers <span className="muted">— {customers.length} customer{customers.length === 1 ? '' : 's'}</span></h3>
        <div className="actions">
          <CopyButton label="COPY TABLE" primary onCopy={() => copyTable(TIER_TABLE_HEADERS, rows)} />
          <button type="button" className="btn btn-link" onClick={() => downloadCsv('customer-tiers.csv', TIER_TABLE_HEADERS, rows)}>Export CSV</button>
        </div>
      </div>
      {sorted.length === 0 ? (
        <p className="empty-note">No A/B/C/D customers match the current filters.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table tiers">
            <thead>
              <tr>
                <th className="expander" />
                <SortHeader label="Sales Rep" colKey="rep" sort={sort} onToggle={toggle} />
                <SortHeader label="Company" colKey="company" sort={sort} onToggle={toggle} />
                <SortHeader label="Tier" colKey="tier" sort={sort} onToggle={toggle} />
                <SortHeader label="Credit Criteria" colKey="credit" sort={sort} onToggle={toggle} />
                <SortHeader label="Order Criteria" colKey="orders" sort={sort} onToggle={toggle} />
                <SortHeader label="Spend Criteria" colKey="spend" sort={sort} onToggle={toggle} />
                <SortHeader label="Vendor Mix Criteria" colKey="vendors" sort={sort} onToggle={toggle} />
                <SortHeader label="Falls Out Of Tier" colKey="fallout" sort={sort} onToggle={toggle} title="Earliest date the customer stops meeting its current tier if no further orders are placed. Hover a date for the reason." />
                <SortHeader label="Last Order Date" colKey="lastOrder" sort={sort} onToggle={toggle} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const key = c.metrics.companyKey;
                const open = expanded === key;
                return (
                  <Fragment key={key}>
                    <tr className={`clickable ${open ? 'open' : ''}`} onClick={() => setExpanded(open ? null : key)}>
                      <td className="expander" aria-label={open ? 'Collapse' : 'Expand'}>{open ? '▾' : '▸'}</td>
                      <td>{c.metrics.salesRep}</td>
                      <td className="company">{c.metrics.company}</td>
                      <td><TierBadge tier={c.tier.tier as RankedTierCode} /></td>
                      <td>{c.tier.reasons.credit.display}</td>
                      <td>{c.tier.reasons.orders.display}</td>
                      <td>{c.tier.reasons.spend.display}</td>
                      <td>{c.tier.reasons.vendorMix.display}</td>
                      <FalloutCell c={c} />
                      <td>{formatDate(c.metrics.lastOrderDate)}</td>
                    </tr>
                    {open && (
                      <tr className="detail-row">
                        <td colSpan={10}><CustomerDetail customer={c} /></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
