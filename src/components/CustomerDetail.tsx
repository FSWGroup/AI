import type { CustomerAnalysis } from '../types';
import { formatDate } from '../utils/dates';
import { formatMoney } from '../utils/money';
import { pluralize } from '../utils/normalization';
import { tierLabel } from './TierBadge';

interface Props {
  customer: CustomerAnalysis;
}

/** Supporting detail for one customer row (expanded view). */
export function CustomerDetail({ customer }: Props) {
  const { metrics: m, tier, nextTier, fallout } = customer;
  const windowKeys = new Set(m.windowOrders.map((o) => o.orderKey));
  const paymentByKey = new Map(m.paymentAssessments.map((a) => [a.orderKey, a]));
  const orders = [...m.normalizedOrders].sort((a, b) => (b.orderDate?.getTime() ?? 0) - (a.orderDate?.getTime() ?? 0));
  return (
    <div className="customer-detail">
      <div className="detail-grid">
        <div>
          <h4>Position</h4>
          <dl>
            <dt>Company</dt><dd>{m.company}</dd>
            <dt>Sales Rep</dt><dd>{m.salesRep}</dd>
            <dt>Tier</dt><dd>{tierLabel(tier.tier)}</dd>
            <dt>12-month qualifying spend</dt><dd>{formatMoney(m.rollingSpend)}</dd>
            <dt>12-month qualifying orders</dt><dd>{m.rollingOrderCount}</dd>
            <dt>Last order date</dt><dd>{formatDate(m.lastOrderDate) || '—'}</dd>
            <dt>Vendor mix</dt>
            <dd>
              {pluralize(m.vendorCount, 'vendor')}
              {m.vendors.length > 0 && <ul className="vendor-list">{m.vendors.map((v) => <li key={v}>{v}</li>)}</ul>}
            </dd>
          </dl>
        </div>
        <div>
          <h4>Credit / Payment</h4>
          <dl>
            <dt>Credit terms</dt><dd>{m.hasEstablishedCredit ? `Established — ${m.creditTermsLabel}` : 'No established credit terms (pay-as-you-go)'}</dd>
            <dt>Payment history</dt><dd>{m.paymentHistoryExplanation}</dd>
            <dt>90+ days past due</dt><dd>{m.has90DayPastDueInvoice ? m.seriousDelinquencyExplanation : 'None'}</dd>
            {tier.eReasons.length > 0 && (<><dt>Tier E reasons</dt><dd>{tier.eReasons.join('; ')}</dd></>)}
          </dl>
          <h4>Why this tier</h4>
          <p className="muted">{tier.explanation}</p>
          <ul className="criteria-list">
            <li><strong>Credit:</strong> {tier.reasons.credit.display}</li>
            <li><strong>Orders:</strong> {tier.reasons.orders.display}</li>
            <li><strong>Spend:</strong> {tier.reasons.spend.display}</li>
            <li><strong>Vendor mix:</strong> {tier.reasons.vendorMix.display}</li>
          </ul>
        </div>
        <div>
          <h4>Next tier</h4>
          <dl>
            <dt>Target</dt><dd>{nextTier.nextTier ? tierLabel(nextTier.nextTier) : '—'}</dd>
            <dt>What is needed</dt><dd>{nextTier.summary}</dd>
            {nextTier.nextTier && (
              <>
                <dt>Additional spend</dt><dd>{formatMoney(nextTier.additionalSpend)}</dd>
                <dt>Additional orders</dt><dd>{nextTier.additionalOrders}</dd>
                <dt>Additional vendors</dt><dd>{nextTier.additionalVendors}</dd>
                <dt>Credit requirement</dt><dd>{nextTier.creditRequirementMet ? 'Met' : `Not met — ${nextTier.creditRequirement}`}</dd>
              </>
            )}
          </dl>
          <h4>Falls out of tier</h4>
          <p>{fallout.falloutDate ? `${formatDate(fallout.falloutDate)} (${fallout.daysUntil} days)` : '—'}</p>
          <p className="muted">{fallout.reason}</p>
        </div>
      </div>
      <h4>Orders in the tracker ({orders.length})</h4>
      <div className="table-scroll">
        <table className="data-table compact">
          <thead>
            <tr>
              <th>Order Date</th>
              <th className="num">Qualifying Value</th>
              <th>Vendors</th>
              <th>Payment</th>
              <th>Status</th>
              <th>Sales Rep</th>
              <th>Identifiers</th>
              <th>Rows</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const pay = paymentByKey.get(o.orderKey);
              return (
                <tr key={o.orderKey} className={!o.qualifying ? 'row-muted' : windowKeys.has(o.orderKey) ? 'row-window' : ''}>
                  <td>{formatDate(o.orderDate) || '—'}</td>
                  <td className="num">{o.qualifying ? formatMoney(o.orderValue) : '—'}{o.refundAmount > 0 && o.qualifying ? <span className="muted"> (−{formatMoney(o.refundAmount)} refund)</span> : null}</td>
                  <td>{o.vendors.join(', ') || '—'}</td>
                  <td>{[o.paymentMethod, o.paymentStatus].filter(Boolean).join(' · ') || '—'}{pay && pay.state !== 'paid' ? <span className="muted"> — {pay.explanation}</span> : null}</td>
                  <td>{o.qualifying ? (windowKeys.has(o.orderKey) ? 'Qualifying (in 12-month window)' : 'Qualifying (outside window)') : `Excluded: ${o.disqualifyReason}`}</td>
                  <td>{o.salesRep}</td>
                  <td className="muted small">{o.orderIdentifiers.join(', ')}</td>
                  <td className="muted small">{o.sourceRows.join(', ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
