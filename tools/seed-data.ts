/**
 * Demonstration catalogue (spec §66).
 *
 * Deliberately realistic: several manufacturers, several valve types, sizes,
 * materials, connections and pressure classes, quantities in both PSI and bar,
 * actuated and manual variants, certifications, and — importantly — products that are
 * incomplete or wrong on purpose, because a seed where everything is perfect proves
 * nothing about the data-quality machinery.
 */
import type { Database } from '../src/platform/db/index.js';
import { withUnitOfWork } from '../src/kernel/unit-of-work.js';
import { createContext, SYSTEM_ACTOR } from '../src/kernel/context.js';
import { createIdGenerator, type IdGenerator } from '../src/kernel/id.js';
import { systemClock, type Clock } from '../src/kernel/clock.js';
import {
  createBrand,
  createProduct,
  createVariant,
  loadCatalogDeps,
  setAttributeValues,
  type AttributeAssignment,
} from '../src/modules/pim/index.js';

export interface SeedResult {
  readonly brands: number;
  readonly products: number;
  readonly variants: number;
}

interface VariantSpec {
  readonly mpn: string;
  readonly name: string;
  readonly sku?: string;
  readonly attributes: readonly AttributeAssignment[];
  /** Marks a variant that is deliberately incomplete, and why. */
  readonly deliberatelyIncomplete?: string;
}

interface ProductSpec {
  readonly key: string;
  readonly brandKey: string;
  readonly productTypeKey: string;
  readonly name: string;
  readonly modelSeries: string;
  /** Values every variant inherits unless it overrides them. */
  readonly attributes: readonly AttributeAssignment[];
  readonly variants: readonly VariantSpec[];
}

const BRANDS = [
  { key: 'apollo', name: 'Apollo Valves' },
  { key: 'bonomi', name: 'Bonomi' },
  { key: 'bray', name: 'Bray International' },
  { key: 'asco', name: 'ASCO' },
  { key: 'watts', name: 'Watts' },
];

const PRODUCTS: readonly ProductSpec[] = [
  {
    key: 'apollo_77c',
    brandKey: 'apollo',
    productTypeKey: 'ball_valve',
    name: 'Apollo 77C Series bronze ball valve',
    modelSeries: '77C',
    // Set once on the product; every variant inherits these.
    attributes: [
      { attributeKey: 'body_material', value: 'BRONZE_C83600' },
      { attributeKey: 'body_style', value: 'TWO_PIECE' },
      { attributeKey: 'port_configuration', value: 'TWO_WAY' },
      { attributeKey: 'port_size', value: 'FULL_PORT' },
      { attributeKey: 'seat_material', value: 'RPTFE' },
      { attributeKey: 'actuation_type', value: 'MANUAL_LEVER' },
      { attributeKey: 'temperature_min', value: { value: -20, unit: '[degF]' } },
      { attributeKey: 'temperature_max', value: { value: 400, unit: '[degF]' } },
      { attributeKey: 'end_connection', value: 'THREADED_NPT' },
      { attributeKey: 'connection_standard', value: 'ASME_B1_20_1' },
    ],
    variants: [
      {
        mpn: '77C-103-01',
        name: '1/2" 77C bronze ball valve, NPT',
        sku: 'VM-77C-103-01',
        attributes: [
          { attributeKey: 'nominal_size', value: 'NPS_1_2' },
          { attributeKey: 'cv', value: { value: 15.6, unit: '[Cv]' } },
          {
            attributeKey: 'wog_pressure',
            value: { value: 600, unit: '[psig]' },
            enteredRaw: '600 WOG',
          },
          { attributeKey: 'pressure_class', value: 'ASME_CLASS_150' },
        ],
      },
      {
        mpn: '77C-104-01',
        name: '3/4" 77C bronze ball valve, NPT',
        sku: 'VM-77C-104-01',
        attributes: [
          { attributeKey: 'nominal_size', value: 'NPS_3_4' },
          { attributeKey: 'cv', value: { value: 32.0, unit: '[Cv]' } },
          { attributeKey: 'wog_pressure', value: { value: 600, unit: '[psig]' } },
          { attributeKey: 'pressure_class', value: 'ASME_CLASS_150' },
        ],
      },
      {
        mpn: '77C-105-01',
        name: '1" 77C bronze ball valve, NPT',
        sku: 'VM-77C-105-01',
        attributes: [
          { attributeKey: 'nominal_size', value: 'NPS_1' },
          { attributeKey: 'cv', value: { value: 57.0, unit: '[Cv]' } },
          { attributeKey: 'wog_pressure', value: { value: 600, unit: '[psig]' } },
          { attributeKey: 'pressure_class', value: 'ASME_CLASS_150' },
        ],
      },
      {
        mpn: '77C-106-01',
        name: '1-1/4" 77C bronze ball valve, NPT',
        // No SKU and no Cv: exercises both the identifier rule and the required
        // attribute rule.
        deliberatelyIncomplete:
          'no ValveMan SKU and no Cv, to exercise the publishability rules',
        attributes: [
          { attributeKey: 'nominal_size', value: 'NPS_1_1_4' },
          { attributeKey: 'wog_pressure', value: { value: 600, unit: '[psig]' } },
        ],
      },
    ],
  },
  {
    key: 'apollo_76f',
    brandKey: 'apollo',
    productTypeKey: 'ball_valve',
    name: 'Apollo 76F Series stainless ball valve',
    modelSeries: '76F',
    attributes: [
      { attributeKey: 'body_material', value: 'SS_316' },
      { attributeKey: 'body_style', value: 'THREE_PIECE' },
      { attributeKey: 'port_configuration', value: 'TWO_WAY' },
      { attributeKey: 'port_size', value: 'FULL_PORT' },
      { attributeKey: 'seat_material', value: 'PTFE' },
      { attributeKey: 'trim_material', value: 'SS_316' },
      { attributeKey: 'actuation_type', value: 'MANUAL_LEVER' },
      { attributeKey: 'end_connection', value: 'SOCKET_WELD' },
      { attributeKey: 'temperature_max', value: { value: 450, unit: '[degF]' } },
      { attributeKey: 'is_fire_safe', value: true },
      { attributeKey: 'certifications', value: 'API_607', ordinal: 0 },
      { attributeKey: 'certifications', value: 'NACE_MR0175', ordinal: 1 },
    ],
    variants: [
      {
        mpn: '76F-104-01',
        name: '3/4" 76F stainless ball valve, socket weld',
        sku: 'VM-76F-104-01',
        attributes: [
          { attributeKey: 'nominal_size', value: 'NPS_3_4' },
          { attributeKey: 'cv', value: { value: 30.0, unit: '[Cv]' } },
          { attributeKey: 'pressure_class', value: 'ASME_CLASS_300' },
          // Entered in bar on purpose: proves cross-unit filtering end to end.
          {
            attributeKey: 'wog_pressure',
            value: { value: 68.9, unit: 'bar{gauge}' },
            enteredRaw: '68.9 barg',
          },
        ],
      },
      {
        mpn: '76F-105-01',
        name: '1" 76F stainless ball valve, socket weld',
        sku: 'VM-76F-105-01',
        attributes: [
          { attributeKey: 'nominal_size', value: 'NPS_1' },
          { attributeKey: 'cv', value: { value: 55.0, unit: '[Cv]' } },
          { attributeKey: 'pressure_class', value: 'ASME_CLASS_300' },
          { attributeKey: 'wog_pressure', value: { value: 1000, unit: '[psig]' } },
        ],
      },
      {
        mpn: '76F-106-01-EA',
        name: '1-1/4" 76F stainless ball valve, electric actuated',
        sku: 'VM-76F-106-01-EA',
        attributes: [
          { attributeKey: 'nominal_size', value: 'NPS_1_1_4' },
          { attributeKey: 'cv', value: { value: 90.0, unit: '[Cv]' } },
          { attributeKey: 'pressure_class', value: 'ASME_CLASS_300' },
          { attributeKey: 'wog_pressure', value: { value: 1000, unit: '[psig]' } },
          // Overrides the product-level manual actuation, which makes voltage,
          // frequency and fail position conditionally required.
          { attributeKey: 'actuation_type', value: 'ELECTRIC' },
          { attributeKey: 'voltage', value: { value: 120, unit: 'V' } },
          { attributeKey: 'frequency', value: { value: 60, unit: 'Hz' } },
          { attributeKey: 'fail_position', value: 'FAIL_LAST' },
        ],
      },
      {
        mpn: '76F-107-01-EA',
        name: '1-1/2" 76F stainless ball valve, electric actuated',
        sku: 'VM-76F-107-01-EA',
        deliberatelyIncomplete:
          'electric actuation with no voltage, to exercise the conditional rule',
        attributes: [
          { attributeKey: 'nominal_size', value: 'NPS_1_1_2' },
          { attributeKey: 'cv', value: { value: 120.0, unit: '[Cv]' } },
          { attributeKey: 'pressure_class', value: 'ASME_CLASS_300' },
          { attributeKey: 'wog_pressure', value: { value: 1000, unit: '[psig]' } },
          { attributeKey: 'actuation_type', value: 'ELECTRIC' },
          // voltage, frequency and fail_position deliberately absent
        ],
      },
    ],
  },
  {
    key: 'bray_series_30',
    brandKey: 'bray',
    productTypeKey: 'butterfly_valve',
    name: 'Bray Series 30 resilient seated butterfly valve',
    modelSeries: 'S30',
    attributes: [
      { attributeKey: 'body_material', value: 'DUCTILE_IRON' },
      { attributeKey: 'body_style', value: 'LUG_BODY' },
      { attributeKey: 'end_connection', value: 'LUG' },
      { attributeKey: 'seat_material', value: 'EPDM' },
      { attributeKey: 'trim_material', value: 'SS_316' },
      { attributeKey: 'seat_design', value: 'RESILIENT' },
      { attributeKey: 'actuation_type', value: 'MANUAL_GEAR' },
      { attributeKey: 'temperature_max', value: { value: 250, unit: '[degF]' } },
    ],
    variants: [
      {
        mpn: 'S30-0300-11300',
        name: '3" Series 30 butterfly valve, lug',
        sku: 'VM-S30-3',
        attributes: [
          { attributeKey: 'nominal_size', value: 'NPS_3' },
          { attributeKey: 'cv', value: { value: 220, unit: '[Cv]' } },
          { attributeKey: 'pressure_class', value: 'ASME_CLASS_150' },
          { attributeKey: 'wog_pressure', value: { value: 200, unit: '[psig]' } },
        ],
      },
      {
        mpn: 'S30-0400-11300',
        name: '4" Series 30 butterfly valve, lug',
        sku: 'VM-S30-4',
        attributes: [
          { attributeKey: 'nominal_size', value: 'NPS_4' },
          { attributeKey: 'cv', value: { value: 490, unit: '[Cv]' } },
          { attributeKey: 'pressure_class', value: 'ASME_CLASS_150' },
          { attributeKey: 'wog_pressure', value: { value: 200, unit: '[psig]' } },
        ],
      },
      {
        mpn: 'S30-0600-11300',
        name: '6" Series 30 butterfly valve, lug',
        sku: 'VM-S30-6',
        attributes: [
          { attributeKey: 'nominal_size', value: 'NPS_6' },
          { attributeKey: 'cv', value: { value: 1200, unit: '[Cv]' } },
          { attributeKey: 'pressure_class', value: 'ASME_CLASS_150' },
          { attributeKey: 'wog_pressure', value: { value: 14, unit: 'bar{gauge}' } },
        ],
      },
    ],
  },
  {
    key: 'asco_8210',
    brandKey: 'asco',
    productTypeKey: 'solenoid_valve',
    name: 'ASCO 8210 Series general service solenoid valve',
    modelSeries: '8210',
    attributes: [
      { attributeKey: 'body_material', value: 'BRASS_C36000' },
      { attributeKey: 'seal_material', value: 'NBR' },
      { attributeKey: 'end_connection', value: 'THREADED_NPT' },
      { attributeKey: 'actuation_type', value: 'SOLENOID' },
      { attributeKey: 'port_configuration', value: 'TWO_WAY' },
      { attributeKey: 'fail_position', value: 'FAIL_CLOSED' },
      { attributeKey: 'temperature_max', value: { value: 180, unit: '[degF]' } },
    ],
    variants: [
      {
        mpn: '8210G094',
        name: '3/4" 8210 solenoid valve, 120 V',
        sku: 'VM-8210G094',
        attributes: [
          { attributeKey: 'nominal_size', value: 'NPS_3_4' },
          { attributeKey: 'cv', value: { value: 5.0, unit: '[Cv]' } },
          { attributeKey: 'voltage', value: { value: 120, unit: 'V' } },
          { attributeKey: 'frequency', value: { value: 60, unit: 'Hz' } },
          { attributeKey: 'wog_pressure', value: { value: 150, unit: '[psig]' } },
        ],
      },
      {
        mpn: '8210G095',
        name: '3/4" 8210 solenoid valve, 24 VDC',
        sku: 'VM-8210G095',
        attributes: [
          { attributeKey: 'nominal_size', value: 'NPS_3_4' },
          { attributeKey: 'cv', value: { value: 5.0, unit: '[Cv]' } },
          { attributeKey: 'voltage', value: { value: 24, unit: 'V' } },
          { attributeKey: 'wog_pressure', value: { value: 150, unit: '[psig]' } },
        ],
      },
    ],
  },
  {
    key: 'watts_lf_ball',
    brandKey: 'watts',
    productTypeKey: 'ball_valve',
    name: 'Watts LFFBV-3C lead-free ball valve',
    modelSeries: 'LFFBV-3C',
    attributes: [
      { attributeKey: 'body_material', value: 'BRASS_LEAD_FREE' },
      { attributeKey: 'body_style', value: 'TWO_PIECE' },
      { attributeKey: 'port_configuration', value: 'TWO_WAY' },
      { attributeKey: 'port_size', value: 'FULL_PORT' },
      { attributeKey: 'end_connection', value: 'THREADED_NPT' },
      { attributeKey: 'actuation_type', value: 'MANUAL_LEVER' },
      { attributeKey: 'is_lead_free', value: true },
      { attributeKey: 'certifications', value: 'NSF_ANSI_61', ordinal: 0 },
      { attributeKey: 'certifications', value: 'LEAD_FREE', ordinal: 1 },
      { attributeKey: 'temperature_max', value: { value: 250, unit: '[degF]' } },
    ],
    variants: [
      {
        mpn: 'LFFBV-3C-0050',
        name: '1/2" lead-free ball valve',
        sku: 'VM-LFFBV-050',
        attributes: [
          { attributeKey: 'nominal_size', value: 'NPS_1_2' },
          { attributeKey: 'cv', value: { value: 14.0, unit: '[Cv]' } },
          { attributeKey: 'wog_pressure', value: { value: 600, unit: '[psig]' } },
          { attributeKey: 'pressure_class', value: 'ASME_CLASS_150' },
        ],
      },
      {
        mpn: 'LFFBV-3C-0100',
        name: '1" lead-free ball valve',
        sku: 'VM-LFFBV-100',
        attributes: [
          { attributeKey: 'nominal_size', value: 'NPS_1' },
          { attributeKey: 'cv', value: { value: 52.0, unit: '[Cv]' } },
          { attributeKey: 'wog_pressure', value: { value: 600, unit: '[psig]' } },
          { attributeKey: 'pressure_class', value: 'ASME_CLASS_150' },
        ],
      },
    ],
  },
];

export async function seedCatalog(
  db: Database,
  options: { clock?: Clock; ids?: IdGenerator } = {},
): Promise<SeedResult> {
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? createIdGenerator(clock);
  const deps = await loadCatalogDeps(db);
  const context = createContext(ids.next(), {
    actor: { ...SYSTEM_ACTOR, label: 'seed' },
    interface: 'CLI',
    source: 'seed',
    reason: 'demonstration catalogue',
  });

  let variantCount = 0;

  await withUnitOfWork(db, context, { clock, ids }, async (uow) => {
    for (const brand of BRANDS) await createBrand(uow, brand);
  });

  for (const spec of PRODUCTS) {
    await withUnitOfWork(db, context, { clock, ids }, async (uow) => {
      const { productId } = await createProduct(
        uow,
        {
          key: spec.key,
          brandKey: spec.brandKey,
          productTypeKey: spec.productTypeKey,
          name: spec.name,
          modelSeries: spec.modelSeries,
          attributes: spec.attributes,
        },
        deps,
      );

      for (const variant of spec.variants) {
        await createVariant(
          uow,
          {
            productId,
            manufacturerPartNumber: variant.mpn,
            name: variant.name,
            attributes: variant.attributes,
            identifiers: [
              { namespace: 'MPN', value: variant.mpn },
              ...(variant.sku === undefined
                ? []
                : [{ namespace: 'VALVEMAN_SKU', value: variant.sku }]),
            ],
          },
          deps,
        );
        variantCount += 1;
      }
    });
  }

  return { brands: BRANDS.length, products: PRODUCTS.length, variants: variantCount };
}

/**
 * A second source disagreeing with the first, for the survivorship demonstration
 * (acceptance criterion 10). P21 says the 77C 1/2" flows a little differently from
 * what the manufacturer catalogue says.
 */
export async function seedConflictingSource(
  db: Database,
  options: { clock?: Clock; ids?: IdGenerator } = {},
): Promise<{ variantId: string }> {
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? createIdGenerator(clock);
  const deps = await loadCatalogDeps(db);

  const variant = await db
    .selectFrom('pim.variant')
    .select(['id'])
    .where('manufacturer_part_number', '=', '77C-103-01')
    .executeTakeFirstOrThrow();

  await withUnitOfWork(
    db,
    createContext(ids.next(), {
      actor: { ...SYSTEM_ACTOR, label: 'connector:p21' },
      interface: 'CONNECTOR',
      source: 'connector:p21',
      reason: 'nightly item master extract',
    }),
    { clock, ids },
    async (uow) => {
      await setAttributeValues(
        uow,
        { level: 'VARIANT', id: variant.id },
        [
          {
            attributeKey: 'cv',
            value: { value: 14.9, unit: '[Cv]' },
            sourceSystemCode: 'P21',
            sourceField: 'ITEM_CV',
            enteredRaw: '14.9',
          },
        ],
        deps,
      );
    },
  );

  return { variantId: variant.id };
}
