/**
 * lib/tax/schema.ts
 *
 * Runtime validation for the JSON rate files in /data.
 *
 * Why this exists: TypeScript types vanish at build time, so they can't catch a
 * typo in a JSON file. These schemas check the data at load time and fail with
 * a readable message pointing at the exact field — far better than silently
 * computing a wrong tax bill because someone wrote "mils" instead of "mills".
 *
 * Requires: npm install zod
 */

import { z } from 'zod';

// --- primitives ------------------------------------------------------------

const fraction = z.number().min(0).max(1);

const rate = z.object({
  value: z.number(),
  unit: z.enum(['mills', 'perHundred', 'fraction']),
});

/** Wrapper carrying provenance. `verifiedOn: null` means nobody has checked it. */
const sourced = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({
    value: inner,
    source: z.string().url(),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    verifiedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    note: z.string().optional(),
  });

const filingStatusRecord = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({
    single: inner,
    marriedJoint: inner,
    marriedSeparate: inner,
    headOfHousehold: inner,
  });

const incomeTaxBase = z.enum([
  'federalAGI',
  'federalTaxableIncome',
  'stateGrossWithModifications',
]);

const bracket = z.object({
  upTo: z.number().positive().nullable(),
  rate: fraction,
});

const modification = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(['subtraction', 'addition']),
  amount: z.number(),
  appliesWhen: z
    .enum(['always', 'age65Plus', 'retirementIncome', 'socialSecurity'])
    .optional(),
});

// --- income tax ------------------------------------------------------------

export const stateIncomeTaxSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('flat'),
    base: incomeTaxBase,
    rate: fraction,
    standardDeduction: filingStatusRecord(z.number().nonnegative()),
    personalExemption: filingStatusRecord(z.number().nonnegative()).optional(),
    modifications: z.array(modification).optional(),
    surplusRebate: z
      .object({ label: z.string(), estimatedAnnual: z.number() })
      .optional(),
  }),
  z.object({
    kind: z.literal('graduated'),
    base: incomeTaxBase,
    brackets: filingStatusRecord(z.array(bracket).min(1)),
    standardDeduction: filingStatusRecord(z.number().nonnegative()),
    personalExemption: filingStatusRecord(z.number().nonnegative()).optional(),
    modifications: z.array(modification).optional(),
  }),
]);

export const localIncomeTaxSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('flatRate'), rate: fraction, base: incomeTaxBase }),
  z.object({
    kind: z.literal('graduated'),
    brackets: z.array(bracket).min(1),
    base: incomeTaxBase,
  }),
  z.object({
    kind: z.literal('headTax'),
    usdPerMonth: z.number().nonnegative(),
    employeeShare: fraction,
  }),
]);

// --- property tax ----------------------------------------------------------

const levyClass = z.enum(['school', 'county', 'municipal', 'special']);

const levy = z.object({
  jurisdiction: z.string().min(1),
  levyClass,
  rate,
});

const exemptionAmount = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), amount: z.number().nonnegative() }),
  z.object({
    kind: z.literal('percentOfValue'),
    percent: fraction,
    floor: z.number().nonnegative().optional(),
    cap: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('bandedFixed'),
    bands: z
      .array(
        z.object({
          from: z.number().nonnegative(),
          to: z.number().positive().nullable(),
          exempt: z.boolean(),
        }),
      )
      .min(1),
  }),
]);

const exemption = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  amount: exemptionAmount,
  /** Empty array means "applies to every levy class". */
  appliesTo: z.array(levyClass),
  requiresHomestead: z.boolean(),
  eligibility: z.enum([
    'general',
    'age65Plus',
    'disabled',
    'veteran',
    'survivingSpouse',
  ]),
  inflationIndexed: z.boolean().optional(),
  freezesLevyAmount: z.boolean().optional(),
});

const assessmentRule = z.object({
  // A ratio above 1 is always a data-entry error (someone typed 6.25 for 6.25%).
  residentialAssessmentRatio: z.number().positive().max(1),
  revaluationCycleYears: z.number().int().positive(),
});

const valueCap = z.object({
  label: z.string(),
  maxAnnualIncrease: fraction,
  requiresHomestead: z.boolean(),
  portable: z.boolean(),
  resetsOnTransfer: z.boolean(),
});

// --- sales tax -------------------------------------------------------------

const spendCategory = z.enum([
  'groceries',
  'preparedFood',
  'clothing',
  'generalGoods',
  'prescriptionDrugs',
  'services',
  'vehicles',
  'utilities',
]);

const salesTaxComponent = z.object({
  jurisdiction: z.string().min(1),
  rate: fraction,
  exemptCategories: z.array(spendCategory),
  perItemTaxableCap: z.number().positive().optional(),
  onlyCategories: z.array(spendCategory).optional(),
});

// --- vehicle ---------------------------------------------------------------

const vehicleTax = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('none'),
    annualRegistration: z.number().nonnegative(),
  }),
  z.object({
    kind: z.literal('annualValueBased'),
    label: z.string(),
    basis: z.enum(['msrp', 'marketValue', 'assessedValue']),
    rateByAgeYears: z.array(fraction).min(1),
    annualRegistration: z.number().nonnegative(),
  }),
]);

const vehicleCosts = z.object({
  tax: vehicleTax,
  purchaseSalesTaxRate: fraction,
  oneTimeTitleAndFees: z.number().nonnegative(),
});

// --- top level -------------------------------------------------------------

export const stateProfileSchema = z.object({
  code: z.string().length(2),
  name: z.string().min(1),
  incomeTax: sourced(stateIncomeTaxSchema),
  propertyFramework: sourced(
    z.object({
      assessment: assessmentRule,
      valueCap: valueCap.optional(),
      statewideExemptions: z.array(exemption),
    }),
  ),
  stateSalesTax: sourced(salesTaxComponent),
  vehicle: sourced(vehicleCosts),
});

export const localityProfileSchema = z.object({
  id: z.string().min(1),
  city: z.string().min(1),
  county: z.string().min(1),
  state: z.string().length(2),
  localIncomeTax: sourced(localIncomeTaxSchema),
  localSalesTax: sourced(z.array(salesTaxComponent)),
  propertyLevies: sourced(z.array(levy)),
  localExemptions: sourced(z.array(exemption)),
  supplementalDistricts: sourced(z.array(levy)),
});

export type ValidatedStateProfile = z.infer<typeof stateProfileSchema>;
export type ValidatedLocalityProfile = z.infer<typeof localityProfileSchema>;

/** Parse with a readable error that names the file and the offending field. */
export function parseState(raw: unknown, filename: string) {
  const result = stateProfileSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid state config in ${filename}:\n` +
        result.error.issues
          .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('\n'),
    );
  }
  return result.data;
}

export function parseLocality(raw: unknown, filename: string) {
  const result = localityProfileSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid locality config in ${filename}:\n` +
        result.error.issues
          .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('\n'),
    );
  }
  return result.data;
}
