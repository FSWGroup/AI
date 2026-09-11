import { useMemo, useState } from 'react';
import type { DataQualityIssue, Severity } from '../types';
import { copyTable, type CellValue } from '../utils/clipboard';
import { downloadCsv } from '../utils/csv';
import { CopyButton } from './CopyButton';
import { SortHeader, useSortable } from './useSortable';

const HEADERS = ['Issue Type', 'Company', 'Sales Rep', 'Source Row(s)', 'Explanation', 'Severity'];
const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

function rowsLabel(rows: number[]): string {
  if (!rows.length) return '';
  if (rows.length <= 6) return rows.join(', ');
  return `${rows.slice(0, 5).join(', ')} … (+${rows.length - 5} more)`;
}

function issueRow(i: DataQualityIssue): CellValue[] {
  return [i.issueType, i.company, i.salesRep, rowsLabel(i.sourceRows), i.explanation, i.severity];
}

type ColKey = 'type' | 'company' | 'rep' | 'rows' | 'severity';
const ACCESSORS: Record<ColKey, (i: DataQualityIssue) => string | number | null> = {
  type: (i) => i.issueType,
  company: (i) => i.company,
  rep: (i) => i.salesRep,
  rows: (i) => i.sourceRows[0] ?? null,
  severity: (i) => SEVERITY_RANK[i.severity],
};

interface Props {
  issues: DataQualityIssue[];
  reps: string[];
}

export function DataReviewTable({ issues }: Props) {
  const [severity, setSeverity] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [hideLow, setHideLow] = useState(true);
  const [type, setType] = useState('ALL');
  const [search, setSearch] = useState('');

  const types = useMemo(() => [...new Set(issues.map((i) => i.issueType))].sort(), [issues]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return issues.filter((i) => {
      if (severity !== 'all' && i.severity !== severity) return false;
      if (severity === 'all' && hideLow && i.severity === 'low') return false;
      if (type !== 'ALL' && i.issueType !== type) return false;
      if (q && !(i.company.toLowerCase().includes(q) || i.explanation.toLowerCase().includes(q) || i.salesRep.toLowerCase().includes(q) || i.sourceRows.some((r) => String(r) === q))) return false;
      return true;
    });
  }, [issues, severity, hideLow, type, search]);
  const { sorted, sort, toggle } = useSortable<DataQualityIssue, ColKey>(filtered, ACCESSORS);
  const rows = useMemo(() => sorted.map(issueRow), [sorted]);
  const counts = useMemo(() => ({ high: issues.filter((i) => i.severity === 'high').length, medium: issues.filter((i) => i.severity === 'medium').length, low: issues.filter((i) => i.severity === 'low').length }), [issues]);

  return (
    <>
      <p className="tab-intro">Questionable rows, orders and customers found during analysis. Source rows refer to the Excel row numbers in the MAIN worksheet. This tab is for verification; it does not change any tier.</p>
      <div className="filter-bar">
        <label className="field">
          <span className="field-label">Severity</span>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
            <option value="all">All</option>
            <option value="high">High ({counts.high})</option>
            <option value="medium">Medium ({counts.medium})</option>
            <option value="low">Low ({counts.low})</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Issue Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="ALL">All</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field field-grow">
          <span className="field-label">Search</span>
          <input type="search" value={search} placeholder="Company, rep, explanation or row number" onChange={(e) => setSearch(e.target.value)} />
        </label>
        {severity === 'all' && (
          <label className="field checkbox">
            <input type="checkbox" checked={hideLow} onChange={(e) => setHideLow(e.target.checked)} />
            <span>Hide low severity</span>
          </label>
        )}
      </div>
      <div className="panel-header">
        <h3>Data Review <span className="muted">— {sorted.length} of {issues.length} issues</span></h3>
        <div className="actions">
          <CopyButton label="COPY TABLE" primary onCopy={() => copyTable(HEADERS, rows)} />
          <button type="button" className="btn btn-link" onClick={() => downloadCsv('data-review.csv', HEADERS, rows)}>Export CSV</button>
        </div>
      </div>
      {sorted.length === 0 ? (
        <p className="empty-note">No issues match the current filters.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table review">
            <thead>
              <tr>
                <SortHeader label="Issue Type" colKey="type" sort={sort} onToggle={toggle} />
                <SortHeader label="Company" colKey="company" sort={sort} onToggle={toggle} />
                <SortHeader label="Sales Rep" colKey="rep" sort={sort} onToggle={toggle} />
                <SortHeader label="Source Row(s)" colKey="rows" sort={sort} onToggle={toggle} />
                <th className="wide">Explanation</th>
                <SortHeader label="Severity" colKey="severity" sort={sort} onToggle={toggle} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((i) => (
                <tr key={i.id}>
                  <td>{i.issueType}</td>
                  <td className="company">{i.company}</td>
                  <td>{i.salesRep}</td>
                  <td className="small" title={i.sourceRows.join(', ')}>{rowsLabel(i.sourceRows)}</td>
                  <td className="wide">{i.explanation}</td>
                  <td><span className={`severity severity-${i.severity}`}>{i.severity}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
