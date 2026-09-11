import type { TierCode } from '../types';
import { TIER_NAMES } from '../config/tierRules';

interface Props {
  tier: TierCode;
  /** "badge" shows just the letter with a tooltip; "full" shows "A — Strategic". */
  variant?: 'badge' | 'full';
}

export function TierBadge({ tier, variant = 'badge' }: Props) {
  const name = TIER_NAMES[tier] ?? tier;
  const label = variant === 'full' ? `${tier} — ${name}` : tier;
  return (
    <span className={`tier-badge tier-${tier.toLowerCase()}`} title={`${tier} — ${name}`}>
      {label}
    </span>
  );
}

export function tierLabel(tier: TierCode): string {
  return `${tier} — ${TIER_NAMES[tier] ?? tier}`;
}
