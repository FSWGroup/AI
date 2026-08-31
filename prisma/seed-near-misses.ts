import type { PrismaClient } from "@prisma/client";

/**
 * Demonstration near-miss case studies.
 *
 * These are ILLUSTRATIVE EXAMPLES written for this seed, not real FSW events
 * and not FSW policy. They exist so the library, the review queue, the
 * "why this procedure exists" panel and the AI corpus all have truthful state
 * to show on a fresh install. Replace them before any real rollout.
 *
 * Two properties are demonstrated on purpose:
 *
 *  - Every narrative is written the way a reviewer would leave it: roles, not
 *    people. No name appears in any of them, which is also what lets them pass
 *    the publication check in src/lib/services/near-miss-redaction.ts.
 *  - One record is left in the review queue and one is filed anonymously, so
 *    the reviewer surfaces are not empty and the anonymity path is visible.
 */

interface NearMissSpec {
  reference: string;
  title: string;
  category:
    | "PRODUCT_SELECTION"
    | "ORDER_ACCURACY"
    | "WAREHOUSE_SAFETY"
    | "CUSTOMER_COMMITMENT"
    | "DATA_SECURITY"
    | "SUPPLIER"
    | "OTHER";
  severity: "NEAR_MISS" | "MINOR" | "SIGNIFICANT" | "SERIOUS";
  status: "REPORTED" | "UNDER_REVIEW" | "PUBLISHED";
  /** Seed account that filed it, or null for an anonymous report. */
  reportedByEmail: string | null;
  department: string | null;
  locationKey: string | null;
  /** Days before today. */
  occurredDaysAgo: number;
  whatHappened: string;
  howItWasCaught: string | null;
  whyItHappened: string | null;
  whatChanged: string | null;
  /** SOP code from seed-content.ts, when one covers it. */
  preventingSopCode: string | null;
  /** Course key from seed-content.ts, when one teaches it. */
  teachingCourseKey: string | null;
}

const DEMO_NEAR_MISSES: NearMissSpec[] = [
  {
    reference: "NM-001",
    title: "150# flange picked for a 300# service",
    category: "PRODUCT_SELECTION",
    severity: "NEAR_MISS",
    status: "PUBLISHED",
    reportedByEmail: "kim.harlow@fswelsford.com",
    department: "Operations",
    locationKey: "loc_warehouse",
    occurredDaysAgo: 46,
    whatHappened:
      "A pick list called for a 3-inch 300# raised-face flange. The 150# and 300# versions of that flange sit in adjacent bins and their part numbers differ by one character. The 150# part was picked and staged for a line that runs at 380 psi on start-up.",
    howItWasCaught:
      "At the packing bench. The gasket in the kit would not seat against the face, and the packer stopped to work out why rather than forcing it.",
    whyItHappened:
      "Two conditions together: adjacent bins for parts that look identical at arm's length, and a pick list that printed the part number but not the pressure class. Nothing on the shelf or the paper made the difference visible at the moment of picking.",
    whatChanged:
      "Bin labels for flanged products now carry the pressure class in 40pt type as the first line, above the part number. The pick list template prints the pressure class next to the description. The two bins were separated by a full rack section.",
    preventingSopCode: "OPS-014",
    teachingCourseKey: "valve-fundamentals",
  },
  {
    reference: "NM-002",
    title: "Same-day shipping promised before stock was checked",
    category: "CUSTOMER_COMMITMENT",
    severity: "MINOR",
    status: "PUBLISHED",
    reportedByEmail: "jordan.pace@fswelsford.com",
    department: "Sales",
    locationKey: "loc_hq",
    occurredDaysAgo: 31,
    whatHappened:
      "A customer asked whether four actuated ball valves could ship the same day. The quote went out promising it. The quantity showing as available included two units already allocated to another order, so only two could actually ship.",
    howItWasCaught:
      "The warehouse flagged the shortfall when the pick list printed, about ninety minutes after the promise was made — early enough to call the customer before they had planned around it.",
    whyItHappened:
      "The availability figure on the quoting screen is on-hand quantity, not available-to-promise, and the two look the same at a glance. Nothing in the workflow required checking allocations before making a dated commitment.",
    whatChanged:
      "The quote template no longer contains a same-day shipping line that can be filled in without an allocation check. The quoting procedure now says explicitly that a dated commitment needs available-to-promise, and shows where to find it.",
    preventingSopCode: "SALES-001",
    teachingCourseKey: "quote-process",
  },
  {
    reference: "NM-003",
    title: "Convincing invoice-payment email nearly actioned",
    category: "DATA_SECURITY",
    severity: "NEAR_MISS",
    status: "PUBLISHED",
    reportedByEmail: null,
    department: null,
    locationKey: null,
    occurredDaysAgo: 22,
    whatHappened:
      "An email arrived that appeared to come from a known supplier, referencing a real open invoice number and asking for payment to a new bank account. The formatting, signature and invoice reference were all correct. The sending domain differed from the supplier's by one transposed character.",
    howItWasCaught:
      "The person handling it called the supplier on the number already on file — not the number in the email — before making any change. The supplier confirmed they had sent nothing.",
    whyItHappened:
      "The message was internally consistent because the invoice number was genuine, which is the part that makes this kind of request persuasive. A correct invoice reference reads as proof of legitimacy, and nothing in the process treated a bank-detail change as a category of request needing its own verification.",
    whatChanged:
      "Any change to supplier bank details now requires a call-back to the number already on file, recorded before the change is made. The technology policy names bank-detail requests as a specific case rather than leaving it to judgment.",
    preventingSopCode: "POL-001",
    teachingCourseKey: "cyber",
  },
  {
    reference: "NM-004",
    title: "Pallet stacked above the rack rail",
    category: "WAREHOUSE_SAFETY",
    severity: "NEAR_MISS",
    status: "PUBLISHED",
    reportedByEmail: "kim.harlow@fswelsford.com",
    department: "Operations",
    locationKey: "loc_warehouse",
    occurredDaysAgo: 12,
    whatHappened:
      "A pallet of cast-iron gate valves was stacked about eight inches above the rack's safety rail so that a part-full pallet would fit in the remaining bay. A forklift passing underneath would have been in the drop path.",
    howItWasCaught:
      "Spotted on a routine walk of the aisle before the next shift started. Nothing fell.",
    whyItHappened:
      "The bay was the only space left near the pick face and the shift was behind. Restacking properly meant a trip to the far end of the building, and the rule about the rail is not marked anywhere on the rack itself.",
    whatChanged:
      "The maximum height line is now painted on the rack uprights, so the limit is visible from the aisle rather than remembered. Two bays near the pick face are kept clear as overflow, which removes the reason to improvise.",
    preventingSopCode: null,
    teachingCourseKey: "warehouse-safety",
  },
  {
    reference: "NM-005",
    title: "Wrong quantity shipped on a split line",
    category: "ORDER_ACCURACY",
    severity: "SIGNIFICANT",
    status: "PUBLISHED",
    reportedByEmail: "jordan.pace@fswelsford.com",
    department: "Operations",
    locationKey: "loc_warehouse",
    occurredDaysAgo: 60,
    whatHappened:
      "An order line for twelve units was split across two shipments. Both shipments went out with twelve, so twenty-four were sent and invoiced. The customer returned twelve at our cost.",
    howItWasCaught:
      "By the customer, on receipt. Not by us — which is why this one is recorded as having cost money rather than as caught in time.",
    whyItHappened:
      "The packing slip for a split line shows the ordered quantity, not the quantity for that shipment. Both packers read the number in front of them and both were reading the wrong field.",
    whatChanged:
      "The packing slip now shows “shipping now: n of m” as the largest number on the page. Split lines are flagged on the pick list so a packer knows before they start that the ordered quantity is not the one to pack.",
    preventingSopCode: "OPS-014",
    teachingCourseKey: null,
  },
  {
    reference: "NM-006",
    title: "Superseded datasheet used for a material recommendation",
    category: "PRODUCT_SELECTION",
    severity: "MINOR",
    status: "UNDER_REVIEW",
    reportedByEmail: "dev.singh@fswelsford.com",
    department: "Application Engineering",
    locationKey: "loc_hq",
    occurredDaysAgo: 8,
    whatHappened:
      "A seat material was recommended for a chemical service based on a printed datasheet in the desk file. The manufacturer had revised the compatibility table eleven months earlier and the printed copy did not carry a revision date.",
    howItWasCaught:
      "The customer's own engineer queried it against a newer datasheet before anything was ordered.",
    whyItHappened: null,
    whatChanged: null,
    preventingSopCode: null,
    teachingCourseKey: null,
  },
  {
    reference: "NM-007",
    title: "Supplier substituted a fitting without telling us",
    category: "SUPPLIER",
    severity: "MINOR",
    status: "REPORTED",
    reportedByEmail: null,
    department: null,
    locationKey: null,
    occurredDaysAgo: 4,
    whatHappened:
      "A carton arrived containing a fitting from a different manufacturer than the one ordered. Dimensionally interchangeable, but a different pressure rating, and the packing list showed the part number we ordered rather than what was in the box.",
    howItWasCaught:
      "During receiving inspection, because the box was a different colour from the usual one and someone opened it to check.",
    whyItHappened: null,
    whatChanged: null,
    preventingSopCode: "OPS-014",
    teachingCourseKey: null,
  },
];

/**
 * Seed the near-miss library.
 *
 * Idempotent by reference, so re-running the seed neither duplicates rows nor
 * overwrites a case study someone edited in a demo. Published rows are written
 * directly with their published state rather than going through
 * publishNearMiss(), because the seed has no acting reviewer session; the
 * publication rules are exercised by tests/integration/near-miss.test.ts.
 */
export async function seedNearMisses(
  prisma: PrismaClient,
  userIds: Map<string, string>,
  departments: Map<string, string>,
  locations: Map<string, string>,
  sopIds: Map<string, string>,
  courseIds: Map<string, string>,
): Promise<void> {
  console.log("→ Near-miss library (demonstration examples)");

  const reviewerId =
    userIds.get("compliance@fswelsford.com") ?? userIds.get("admin@fswelsford.com") ?? null;

  for (const spec of DEMO_NEAR_MISSES) {
    const existing = await prisma.nearMiss.findUnique({
      where: { reference: spec.reference },
      select: { id: true },
    });
    if (existing) continue;

    const published = spec.status === "PUBLISHED";
    const occurredOn = new Date(Date.now() - spec.occurredDaysAgo * 86_400_000);

    await prisma.nearMiss.create({
      data: {
        reference: spec.reference,
        title: spec.title,
        category: spec.category,
        severity: spec.severity,
        status: spec.status,
        whatHappened: spec.whatHappened,
        howItWasCaught: spec.howItWasCaught,
        whyItHappened: spec.whyItHappened,
        whatChanged: spec.whatChanged,
        occurredOn,
        departmentId: spec.department ? (departments.get(spec.department) ?? null) : null,
        locationId: spec.locationKey ? (locations.get(spec.locationKey) ?? null) : null,
        // Null for the anonymous demonstration reports, exactly as the real
        // reporting path stores them.
        reportedById: spec.reportedByEmail ? (userIds.get(spec.reportedByEmail) ?? null) : null,
        publishedById: published ? reviewerId : null,
        publishedAt: published
          ? new Date(occurredOn.getTime() + 6 * 86_400_000)
          : null,
        preventingSopId: spec.preventingSopCode
          ? (sopIds.get(spec.preventingSopCode) ?? null)
          : null,
        teachingCourseId: spec.teachingCourseKey
          ? (courseIds.get(spec.teachingCourseKey) ?? null)
          : null,
      },
    });
  }

  /*
   * Index the published case studies so Ask FSW AI can cite them. Keyword
   * retrieval works with no embedding provider configured; if one is
   * configured the vectors are written too.
   */
  const { indexNearMiss } = await import("../src/lib/ai/indexer");
  const publishedRows = await prisma.nearMiss.findMany({
    where: { status: "PUBLISHED", isDeleted: false },
    select: { id: true },
  });
  for (const row of publishedRows) {
    await indexNearMiss(row.id);
  }
}
