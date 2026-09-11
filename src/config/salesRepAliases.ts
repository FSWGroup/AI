/**
 * Salesperson name normalization.
 *
 * TERRITORY MANAGER is the primary sales-rep field. Shortened names in the tracker
 * are mapped to full names here. Matching is case-insensitive and whitespace-tolerant.
 *
 * Add new aliases as `"short form": "Full Name"`.
 */
export const SALES_REP_ALIASES: Record<string, string> = {
  cleon: 'Cleon Kemp',
  josh: 'Josh Kirk',
  amr: 'Amr Shweiky',
  russ: 'Russ Bailey',
  steve: 'Steve Limanni',
  kurt: 'Kurt Hanusa',
  dan: 'Dan York',
  'jason b': 'Jason Bauman',
  joe: 'Joe Mitchell',
  len: 'Len Casey',
  // "Gil" appears in the tracker; the Customer Tier reference sheet lists this
  // territory as Gilbert Welsford.
  gil: 'Gilbert Welsford',
};

/**
 * TERRITORY MANAGER values that are clearly not an individual salesperson.
 * When one of these is found, ONLINE SUPPORT is inspected instead.
 */
export const NON_PERSON_REP_VALUES: string[] = [
  'online',
  'offline',
  'web',
  'website',
  'marketplace',
  'unknown',
  'n/a',
  'na',
  'none',
  'tbd',
  '-',
  '—',
  '?',
];

export const UNASSIGNED_REP_LABEL = 'Online / Unassigned';
