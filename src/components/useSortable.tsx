import { useMemo, useState } from 'react';

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K | null;
  direction: SortDirection;
}

type Accessor<T> = (row: T) => string | number | Date | null | undefined;

function compareValues(a: ReturnType<Accessor<unknown>>, b: ReturnType<Accessor<unknown>>): number {
  const an = a == null || a === '';
  const bn = b == null || b === '';
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
}

/**
 * Column sorting for tables. `accessors` maps a column key to the value used for sorting.
 * When no sort is active, `fallback` ordering is used.
 */
export function useSortable<T, K extends string>(rows: T[], accessors: Record<K, Accessor<T>>, fallback?: (a: T, b: T) => number) {
  const [sort, setSort] = useState<SortState<K>>({ key: null, direction: 'asc' });
  const sorted = useMemo(() => {
    const list = [...rows];
    if (!sort.key) {
      if (fallback) list.sort(fallback);
      return list;
    }
    const acc = accessors[sort.key];
    list.sort((a, b) => {
      const c = compareValues(acc(a), acc(b));
      return sort.direction === 'asc' ? c : -c;
    });
    return list;
  }, [rows, sort, accessors, fallback]);

  const toggle = (key: K) => {
    setSort((s) => {
      if (s.key !== key) return { key, direction: 'asc' };
      if (s.direction === 'asc') return { key, direction: 'desc' };
      return { key: null, direction: 'asc' };
    });
  };
  return { sorted, sort, toggle };
}

interface SortHeaderProps<K extends string> {
  label: string;
  colKey: K;
  sort: SortState<K>;
  onToggle: (key: K) => void;
  className?: string;
  title?: string;
}

export function SortHeader<K extends string>({ label, colKey, sort, onToggle, className, title }: SortHeaderProps<K>) {
  const active = sort.key === colKey;
  return (
    <th className={`sortable ${className ?? ''}`} onClick={() => onToggle(colKey)} title={title ?? 'Click to sort'} aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <span>{label}</span>
      <span className="sort-indicator">{active ? (sort.direction === 'asc' ? '▲' : '▼') : ''}</span>
    </th>
  );
}
