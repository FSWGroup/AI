import type { ReactNode } from 'react';
import { fromInputDate, toInputDate } from '../utils/dates';

interface RepSelectProps {
  reps: string[];
  value: string;
  onChange: (rep: string) => void;
  allLabel?: string;
}

export const ALL_REPS = '__ALL__';

export function RepSelect({ reps, value, onChange, allLabel = 'All Sales Reps' }: RepSelectProps) {
  return (
    <label className="field">
      <span className="field-label">Sales Rep</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={ALL_REPS}>{allLabel}</option>
        {reps.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
    </label>
  );
}

interface AsOfProps {
  value: Date;
  onChange: (d: Date) => void;
}

export function AsOfDateInput({ value, onChange }: AsOfProps) {
  return (
    <label className="field">
      <span className="field-label">Analysis As Of</span>
      <input
        type="date"
        value={toInputDate(value)}
        onChange={(e) => {
          const d = fromInputDate(e.target.value);
          if (d) onChange(d);
        }}
      />
    </label>
  );
}

interface TierSelectProps {
  value: string;
  onChange: (v: string) => void;
}

export function TierSelect({ value, onChange }: TierSelectProps) {
  return (
    <label className="field">
      <span className="field-label">Tier</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="ALL">All</option>
        <option value="A">A — Strategic</option>
        <option value="B">B — Preferred</option>
        <option value="C">C — Core</option>
        <option value="D">D — Emerging</option>
      </select>
    </label>
  );
}

interface SearchProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export function SearchInput({ value, onChange, placeholder = 'Company search' }: SearchProps) {
  return (
    <label className="field field-grow">
      <span className="field-label">Company Search</span>
      <input type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="filter-bar">{children}</div>;
}
