/**
 * Optional manual company aliases.
 *
 * Companies are grouped by normalized COMPANY NAME (trimmed, repeated spaces
 * collapsed, case-insensitive). The application deliberately does NOT fuzzy-match
 * company names. When the same customer appears under clearly different spellings
 * (for example with and without "LLC"), add an alias here.
 *
 * Keys and values are matched case-insensitively after whitespace normalization.
 *
 *   export const COMPANY_ALIASES: Record<string, string> = {
 *     'Example Company LLC': 'Example Company',
 *     'Example Co.': 'Example Company',
 *   };
 *
 * The Data Review tab lists "Possible duplicate customer naming" issues to help
 * decide which aliases to add.
 */
export const COMPANY_ALIASES: Record<string, string> = {
  // 'Example Company LLC': 'Example Company',
};
