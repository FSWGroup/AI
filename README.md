# ValveMan Customer Tier Analyzer

Internal web application for ValveMan / FSW Group. Upload the current **ValveMan Order Tracker** Excel workbook and the app calculates every customer's tier (A/B/C/D/E), explains why, shows what each customer needs to reach the next tier, ranks each salesperson's ten best tier-growth opportunities, and projects when customers will fall out of their current tier.

Workflow: **Upload Order Tracker → Analyze → See Tiers → See Top Opportunities → Copy Results**

Everything runs in the browser. The workbook is never uploaded, stored, or sent to any server, AI service, or analytics platform. Refreshing the page clears the data. There is no backend.

## Install, run, test, build

```bash
npm install
npm run dev        # http://localhost:5173
npm run test       # Vitest unit tests (calculation engine)
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build locally
```

Optional developer check against a real tracker (the file is read locally and never committed):

```bash
VALVEMAN_TRACKER_PATH="/path/to/VALVEMAN Order Tracker.xlsx" npm run validate:workbook
# optional: VALVEMAN_AS_OF=2026-09-11  VALVEMAN_SPOT="company a,company b"
```

## Deploy to Netlify

`netlify.toml` is included (build `npm run build`, publish `dist`, SPA fallback, Node 20, restrictive headers, no functions).

- **Git-based:** connect the repository in Netlify; settings are picked up from `netlify.toml`.
- **CLI:** `npm run build && npx netlify-cli deploy --prod --dir=dist` (log in with `npx netlify-cli login` first).

## How the analysis works

### Workbook import (`src/services/excelParser.ts`)
- Uses the **MAIN** worksheet (case-insensitive). If MAIN is missing, the sheet whose headers best match the tracker layout is used; otherwise a clear error is shown.
- The header row is detected by scanning the first rows. Columns are matched by **normalized header name** (case, whitespace, line breaks and punctuation are ignored), never by Excel column letters. Missing critical columns (ORDER DATE, COMPANY NAME, TERRITORY MANAGER, PRODUCT VALUE, VENDOR) produce a user-facing message such as "Unable to locate COMPANY NAME in the uploaded workbook."
- Dates (Excel serials, Date cells, text), currency text, blanks, "-", "N/A" are handled. A malformed row becomes a Data Review issue instead of aborting the import.

### Logical orders (`src/services/orderNormalizer.ts`)
Spreadsheet rows are **not** counted as orders. Rows for the same company are linked when they share an identifier (BIGC Order #, QB Sales Receipt / Sales Order #, QB Estimate # base such as `3996` for `3996-A/B/C`, QB Invoice #, VM PO #), when they share a Customer PO # on the same date or adjacent rows, or when a row is a continuation of the row above (blank company/date, or same company and date without its own identifiers). Each linked group is one order.

- **Value:** PRODUCT VALUE 2 is the consolidated order value and is used when present anywhere in the group; PRODUCT VALUE is line-level and is only summed when no PRODUCT VALUE 2 exists. 50%-deposit rows therefore count once.
- **Refunds / cancellations / returns / credit memos / chargebacks** are recognised case-insensitively from PAYMENT STATUS (and MODE OF PAYMENT) and deducted. A fully refunded or cancelled order contributes 0 orders and $0. A partial refund leaves 1 order with reduced spend. Refund rows never create orders.
- **Replacement / sample / courtesy / free** rows contribute nothing. **Fraud** rows are excluded and flagged.
- Vendors come only from legitimate sale rows. Placeholder values (CANCELED, Deleted, Credit Memo, "-", internal warehouse entries) are ignored. "Internal > Manufacturer" cells use the manufacturer.

### Customers (`src/services/customerAggregator.ts`)
- Grouped by normalized COMPANY NAME (trimmed, repeated spaces collapsed, case-insensitive). No fuzzy matching. Manual aliases: `src/config/companyAliases.ts`. Likely duplicates are listed in Data Review.
- **Sales rep:** TERRITORY MANAGER when it names a person, otherwise ONLINE SUPPORT, otherwise "Online / Unassigned". A customer's rep is the rep on the most recent qualifying order that names a person, so historical rep changes never split a company. Aliases: `src/config/salesRepAliases.ts`.
- **Rolling 12-month spend and order count** use `rollingTwelveMonthRange()` in `src/utils/dates.ts`: a 12-calendar-month window ending on and including the Analysis As Of date (as of 09/10/2026 → 09/10/2025 through 09/10/2026).
- **Vendor Mix** = distinct normalized vendors across all legitimate purchase history in the tracker (not limited to 12 months). Vendor spellings are consolidated in `src/config/vendorAliases.ts`.
- **Established credit terms** = Net terms (Net 30/60/90/120, "50% Net30", …) evidenced on a qualifying order in the window or on the most recent qualifying order. Pay-as-you-go methods (credit card, PayPal, ACH, wire, check, …) never count as established credit.
- **Consistent payment history** (`evaluatePaymentHistory`) passes when every applicable qualifying order is paid/cleared or not yet due, with no currently past-due invoice.
- **90+ days past due**: an order that is still unpaid whose INVOICE DUE DATE (or invoice date + Net terms) is 90 or more days before the analysis date. Paid invoices are never counted as delinquent, even if they were paid late. Contradictory payment data is flagged instead.

### Tiers (`src/config/tierRules.ts`, `src/services/tierEngine.ts`)
All thresholds live in `tierRules.ts`. Evaluation order: **E override → A → B → C → D → REVIEW**. All requirements of a tier must be met; the highest qualifying tier wins.

| Tier | Credit | Orders (12M) | Spend (12M) | Vendors |
| --- | --- | --- | --- | --- |
| A Strategic | Established credit terms | 4+ | $30,000+ | 3+ |
| B Preferred | Established terms OR consistent payment history | 3+ | $15,000+ | 2+ |
| C Core | Established terms OR consistent payment history | 2+ | $5,000+ | 1+ |
| D Emerging | Pay-as-you-go / no established credit | exactly 1 | under $1,000 | 1+ |
| E Fired / Fixed Terms | Unpaid invoice 90+ days past due, fraud/chargeback, 100% upfront/fixed terms, or manual override | any | any | any |

Boundaries are exact: $30,000.00 qualifies for A; $1,000.00 does **not** qualify for D. Customers that fit no documented tier (for example one $3,500 order) are classified **REVIEW** rather than forced into a tier. REVIEW also covers customers with no qualifying orders in the window (inactive) or with unusable data. E and REVIEW accounts appear in Data Review, not in the Customer Tiers table.

To change thresholds edit `TIER_RULES` in `src/config/tierRules.ts`. To force accounts to Tier E add their company names to `tierEOverrides` in `src/config/accountOverrides.ts`. To map a short salesperson name add it to `src/config/salesRepAliases.ts` (matching is case-insensitive).

### Next tier and opportunities (`nextTierEngine.ts`, `opportunityEngine.ts`)
Gaps are `max(requirement − actual, 0)` for spend, orders, vendors and credit, phrased for a salesperson ("1 additional qualifying order totaling at least $2,550 from a new vendor.", "Establish credit terms. All purchasing requirements are already met."). REVIEW customers in a tier gap are pointed at Core.

Opportunity score (transparent, not AI): spend progress × 45 + order progress × 25 + vendor progress × 20 + credit × 10, plus +5/+3/+1 when the next tier is A/B/C. Ties: higher 12-month spend, more recent last order, company name. A and E customers, and REVIEW customers without enough data, are excluded.

### Falls out of tier (`src/services/falloutCalculator.ts`)
Assuming no further orders, each window order's expiry (order date + 12 months + 1 day) is simulated in date order. At each date the rolling metrics are recomputed and the current tier's rules re-run; the first date the customer no longer meets its **current** tier is reported with the reason (for example "Order count drops from 4 to 3"). This is a simulation, not "oldest order + 12 months". Vendor Mix does not decay. Dates within 60 days are flagged, within 30 days highlighted.

### Data Review (`src/services/dataReview.ts`)
Row, order and customer level findings with Excel row numbers: invalid dates, missing company/value/vendor, ambiguous grouping, possible duplicate rows, unmatched refunds, partial refunds, contradictory payment data, chargebacks, 90+ day invoices, Tier E accounts, REVIEW accounts, unknown salesperson and inconsistent company naming.

## Project layout

```
src/
  components/   FileUpload, TierBadge, FilterBar, OpportunitiesTable, CustomerTierTable, CustomerDetail, DataReviewTable, CopyButton, useSortable
  pages/        AnalyzerPage
  services/     excelParser, orderNormalizer, paymentAnalyzer, customerAggregator, tierEngine, nextTierEngine, opportunityEngine, falloutCalculator, dataReview, analyzer
  config/       tierRules, salesRepAliases, companyAliases, vendorAliases, accountOverrides
  types/        shared TypeScript types
  utils/        dates, money, normalization, clipboard, csv
scripts/        workbook.validate.ts (developer-only check against a real tracker)
```

Tests use fictional data only. Never commit an Order Tracker workbook or exports containing customer data (`*.xlsx`, `*.xls`, `*.csv` are git-ignored).
