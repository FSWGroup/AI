import { useCallback, useMemo, useState } from 'react';
import type { AnalysisResult, CustomerAnalysis, RankedTierCode } from '../types';
import { normalizeWorkbook, runAnalysis, type NormalizedWorkbook } from '../services/analyzer';
import { parseOrderTracker, WorkbookImportError } from '../services/excelParser';
import { topOpportunitiesForRep } from '../services/opportunityEngine';
import { formatDate, startOfDay } from '../utils/dates';
import { copyTable, copyText } from '../utils/clipboard';
import { downloadCsv } from '../utils/csv';
import { FileUpload } from '../components/FileUpload';
import { ALL_REPS, AsOfDateInput, FilterBar, RepSelect, SearchInput, TierSelect } from '../components/FilterBar';
import { OPPORTUNITY_HEADERS, RepOpportunitiesPanel, opportunityRow, repSummaryText } from '../components/OpportunitiesTable';
import { CustomerTierTable } from '../components/CustomerTierTable';
import { DataReviewTable } from '../components/DataReviewTable';
import { CopyButton } from '../components/CopyButton';

type Stage = 'idle' | 'loading' | 'ready' | 'error';
type Tab = 'opportunities' | 'tiers' | 'review';

const LOADING_STEPS = ['Reading workbook', 'Normalizing orders', 'Calculating customer metrics', 'Calculating tiers', 'Ranking opportunities'];

const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

export function AnalyzerPage() {
  const [stage, setStage] = useState<Stage>('idle');
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [normalized, setNormalized] = useState<NormalizedWorkbook | null>(null);
  const [asOf, setAsOf] = useState<Date>(() => startOfDay(new Date()));
  const [tab, setTab] = useState<Tab>('opportunities');
  const [rep, setRep] = useState<string>(ALL_REPS);
  const [tierFilter, setTierFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  // Everything that depends on the As Of date is derived here; parsing is never repeated.
  const result: AnalysisResult | null = useMemo(() => (normalized ? runAnalysis(normalized, asOf) : null), [normalized, asOf]);

  const handleFile = useCallback(async (file: File) => {
    setStage('loading');
    setError(null);
    setStep(0);
    try {
      await nextFrame();
      const buffer = await file.arrayBuffer();
      const parsed = parseOrderTracker(buffer, file.name);
      setStep(1);
      await nextFrame();
      const norm = normalizeWorkbook(parsed);
      setStep(2);
      await nextFrame();
      setStep(3);
      await nextFrame();
      setStep(4);
      await nextFrame();
      setNormalized(norm);
      setRep(ALL_REPS);
      setSearch('');
      setTierFilter('ALL');
      setTab('opportunities');
      setStage('ready');
    } catch (err) {
      const message = err instanceof WorkbookImportError ? err.message : 'The uploaded workbook could not be read.';
      if (!(err instanceof WorkbookImportError)) console.error('[analyzer] Unexpected error while analyzing the workbook', err);
      setError(message);
      setStage(normalized ? 'ready' : 'error');
    }
  }, [normalized]);

  const tierCustomers = useMemo(() => {
    if (!result) return [] as CustomerAnalysis[];
    const q = search.trim().toLowerCase();
    return result.customers.filter((c) => {
      const t = c.tier.tier;
      if (!(t === 'A' || t === 'B' || t === 'C' || t === 'D')) return false;
      if (rep !== ALL_REPS && c.metrics.salesRep !== rep) return false;
      if (tierFilter !== 'ALL' && t !== (tierFilter as RankedTierCode)) return false;
      if (q && !c.metrics.company.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [result, rep, tierFilter, search]);

  const repsWithOpportunities = useMemo(() => {
    if (!result) return [] as string[];
    const set = new Set(result.opportunities.map((o) => o.salesRep));
    return result.salesReps.filter((r) => set.has(r));
  }, [result]);

  const allTopTens = useMemo(() => {
    if (!result) return [];
    return repsWithOpportunities.map((r) => ({ rep: r, opportunities: topOpportunitiesForRep(result.opportunities, r) }));
  }, [result, repsWithOpportunities]);

  const tierCounts = useMemo(() => {
    const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0, REVIEW: 0, INACTIVE: 0 };
    for (const c of result?.customers ?? []) {
      if (c.tier.tier === 'REVIEW' && c.tier.reviewReason === 'NO_RECENT_ORDERS') counts.INACTIVE++;
      else counts[c.tier.tier] = (counts[c.tier.tier] ?? 0) + 1;
    }
    return counts;
  }, [result]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">VM</span>
          <div>
            <h1>ValveMan Customer Tier Analyzer</h1>
            <p className="subheading">Upload the current Order Tracker to calculate customer tiers and sales opportunities.</p>
          </div>
        </div>
        {result && (
          <div className="header-asof">
            <span className="muted">Analysis As Of</span>
            <strong>{formatDate(asOf)}</strong>
          </div>
        )}
      </header>

      <main className="app-main">
        {stage === 'idle' || stage === 'error' ? (
          <section className="upload-section">
            <FileUpload onFile={handleFile} />
            {error && <div className="alert alert-error" role="alert">{error}</div>}
            <p className="privacy-note">All analysis runs locally in this browser tab. The workbook is not uploaded, stored or sent to any service, and the data disappears when the page is refreshed.</p>
          </section>
        ) : null}

        {stage === 'loading' && (
          <section className="loading-section" aria-live="polite">
            <h2>Analyzing Order Tracker...</h2>
            <ol className="steps">
              {LOADING_STEPS.map((s, i) => (
                <li key={s} className={i < step ? 'done' : i === step ? 'active' : ''}>{s}</li>
              ))}
            </ol>
          </section>
        )}

        {stage === 'ready' && result && (
          <>
            <section className="summary-bar">
              <div className="summary-item"><span className="label">Loaded</span><strong title={result.fileName}>{result.fileName}</strong></div>
              <div className="summary-item"><span className="label">Customers Analyzed</span><strong>{result.totals.customers.toLocaleString()}</strong></div>
              <div className="summary-item"><span className="label">Qualifying Orders</span><strong>{result.totals.qualifyingOrders.toLocaleString()}</strong><span className="muted small">from {result.totals.sourceRows.toLocaleString()} rows</span></div>
              <div className="summary-item"><span className="label">Tiers</span><strong className="tier-counts">A {tierCounts.A} · B {tierCounts.B} · C {tierCounts.C} · D {tierCounts.D}</strong><span className="muted small" title="Inactive = no qualifying orders in the rolling 12-month window">E {tierCounts.E} · Review {tierCounts.REVIEW} · Inactive {tierCounts.INACTIVE}</span></div>
              <div className="summary-item summary-controls">
                <AsOfDateInput value={asOf} onChange={setAsOf} />
                <FileUpload onFile={handleFile} compact />
              </div>
            </section>
            {error && <div className="alert alert-error" role="alert">{error}</div>}

            <nav className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'opportunities'} className={tab === 'opportunities' ? 'active' : ''} onClick={() => setTab('opportunities')}>Top 10 Opportunities</button>
              <button type="button" role="tab" aria-selected={tab === 'tiers'} className={tab === 'tiers' ? 'active' : ''} onClick={() => setTab('tiers')}>Customer Tiers</button>
              <button type="button" role="tab" aria-selected={tab === 'review'} className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>Data Review <span className="count">{result.issues.length}</span></button>
            </nav>

            {tab === 'opportunities' && (
              <section className="tab-panel">
                <FilterBar>
                  <RepSelect reps={result.salesReps} value={rep} onChange={setRep} />
                  <AsOfDateInput value={asOf} onChange={setAsOf} />
                  {rep === ALL_REPS && allTopTens.length > 0 && (
                    <div className="actions actions-right">
                      <CopyButton label="COPY TABLE" primary onCopy={() => copyTable(OPPORTUNITY_HEADERS, allTopTens.flatMap((g) => g.opportunities.map(opportunityRow)))} title="Copy every rep's Top 10 as one table" />
                      <CopyButton label="COPY ALL REP SUMMARIES" onCopy={() => copyText(allTopTens.map((g) => repSummaryText(g.rep, g.opportunities, asOf)).join('\n\n\n'))} />
                      <button type="button" className="btn btn-link" onClick={() => downloadCsv('top-opportunities-all-reps.csv', OPPORTUNITY_HEADERS, allTopTens.flatMap((g) => g.opportunities.map(opportunityRow)))}>Export CSV</button>
                    </div>
                  )}
                </FilterBar>
                <p className="tab-intro">Customers closest to their next tier, ranked by a transparent score (spend, order and vendor progress plus credit). A and E accounts are excluded; REVIEW accounts are included only when their data supports a clear recommendation.</p>
                {rep === ALL_REPS ? (
                  allTopTens.length === 0 ? <p className="empty-note">No next-tier opportunities were identified.</p> : allTopTens.map((g) => <RepOpportunitiesPanel key={g.rep} rep={g.rep} opportunities={g.opportunities} asOf={asOf} grouped />)
                ) : (
                  <RepOpportunitiesPanel rep={rep} opportunities={topOpportunitiesForRep(result.opportunities, rep)} asOf={asOf} />
                )}
              </section>
            )}

            {tab === 'tiers' && (
              <section className="tab-panel">
                <FilterBar>
                  <RepSelect reps={result.salesReps} value={rep} onChange={setRep} />
                  <TierSelect value={tierFilter} onChange={setTierFilter} />
                  <SearchInput value={search} onChange={setSearch} />
                </FilterBar>
                <p className="tab-intro">Current A/B/C/D customers and why they hold their tier. Click a row for supporting detail. Tier E and REVIEW accounts are listed in Data Review. Hover a fall-out date for the reason.</p>
                <CustomerTierTable customers={tierCustomers} />
              </section>
            )}

            {tab === 'review' && (
              <section className="tab-panel">
                <DataReviewTable issues={result.issues} reps={result.salesReps} />
              </section>
            )}
          </>
        )}
      </main>
      <footer className="app-footer">
        <span>Order Frequency and Total Spend use the rolling 12 months ending {formatDate(asOf)}. Product Purchase Mix = distinct vendors across all legitimate purchase history.</span>
      </footer>
    </div>
  );
}
