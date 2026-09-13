/**
 * compute.ts
 *
 * Evaluators for the tax model. Deliberately free of state names — if you find
 * yourself writing `if (state === 'TX')` in here, the config shape is wrong.
 */

import type {
  Bracket,
  Exemption,
  ExemptionAmount,
  Fraction,
  Household,
  Levy,
  LevyClass,
  LocalIncomeTax,
  PropertyTaxSystem,
  Rate,
  SalesTax,
  SpendCategory,
  StateIncomeTax,
  USD,
  VehicleCosts,
} from './types';

// ---------------------------------------------------------------------------
// Rate normalization
// ---------------------------------------------------------------------------

export function toFraction(rate: Rate): Fraction {
  switch (rate.unit) {
    case 'mills':
      return rate.value / 1000;
    case 'perHundred':
      return rate.value / 100;
    case 'fraction':
      return rate.value;
  }
}

// ---------------------------------------------------------------------------
// Property tax: market value -> assessed -> capped -> exempted -> levied
// ---------------------------------------------------------------------------

export interface PropertyTaxInput {
  marketValue: USD;
  /**
   * Assessed value carried forward from the prior year, if the owner held the
   * homestead. Undefined for a new purchase, which is what resets the cap.
   */
  priorAssessedValue?: USD;
  hasHomestead: boolean;
  household: Pick<Household, 'age65Plus' | 'disabled' | 'veteran'>;
}

export interface PropertyTaxResult {
  assessedValue: USD;
  cappedValue: USD;
  /** Taxable value after exemptions, per levy class — they differ by design. */
  taxableByClass: Record<LevyClass, USD>;
  taxByJurisdiction: { jurisdiction: string; levyClass: LevyClass; tax: USD }[];
  total: USD;
  effectiveRateOnMarketValue: Fraction;
}

const LEVY_CLASSES: LevyClass[] = ['school', 'county', 'municipal', 'special'];

function isEligible(ex: Exemption, input: PropertyTaxInput): boolean {
  if (ex.requiresHomestead && !input.hasHomestead) return false;
  switch (ex.eligibility) {
    case 'general':
      return true;
    case 'age65Plus':
      return input.household.age65Plus;
    case 'disabled':
      return input.household.disabled;
    case 'veteran':
      return input.household.veteran;
    case 'survivingSpouse':
      return false;
  }
}

function exemptedAmount(amount: ExemptionAmount, value: USD): USD {
  switch (amount.kind) {
    case 'fixed':
      return Math.min(amount.amount, value);
    case 'percentOfValue': {
      const raw = value * amount.percent;
      const floored = amount.floor ? Math.max(raw, amount.floor) : raw;
      return Math.min(amount.cap ?? Infinity, floored, value);
    }
    case 'bandedFixed':
      // Sum the exempt bands that the value actually reaches.
      return amount.bands.reduce((sum, band) => {
        if (!band.exempt) return sum;
        const top = band.to ?? Infinity;
        return sum + Math.max(0, Math.min(value, top) - band.from);
      }, 0);
  }
}

export function computePropertyTax(
  system: PropertyTaxSystem,
  input: PropertyTaxInput,
): PropertyTaxResult {
  // Stage 1 — assessment ratio.
  const assessedValue =
    input.marketValue * system.assessment.residentialAssessmentRatio;

  // Stage 2 — growth cap. Only bites for a continuing homestead; a purchase
  // resets to market, which is the whole "recent buyer penalty" effect.
  let cappedValue = assessedValue;
  const cap = system.valueCap;
  if (
    cap &&
    input.priorAssessedValue !== undefined &&
    (!cap.requiresHomestead || input.hasHomestead)
  ) {
    cappedValue = Math.min(
      assessedValue,
      input.priorAssessedValue * (1 + cap.maxAnnualIncrease),
    );
  }

  // Stage 3 — exemptions, resolved separately per levy class.
  const active = system.exemptions.filter((ex) => isEligible(ex, input));
  const taxableByClass = {} as Record<LevyClass, USD>;

  for (const cls of LEVY_CLASSES) {
    const applicable = active.filter(
      (ex) => ex.appliesTo.length === 0 || ex.appliesTo.includes(cls),
    );
    const totalExempt = applicable.reduce(
      (sum, ex) => sum + exemptedAmount(ex.amount, cappedValue),
      0,
    );
    taxableByClass[cls] = Math.max(0, cappedValue - totalExempt);
  }

  // Stage 4 — apply levies, including parcel-level supplemental districts.
  const allLevies: Levy[] = [...system.levies, ...system.supplementalDistricts];
  const taxByJurisdiction = allLevies.map((levy) => ({
    jurisdiction: levy.jurisdiction,
    levyClass: levy.levyClass,
    tax: taxableByClass[levy.levyClass] * toFraction(levy.rate),
  }));

  const total = taxByJurisdiction.reduce((sum, l) => sum + l.tax, 0);

  return {
    assessedValue,
    cappedValue,
    taxableByClass,
    taxByJurisdiction,
    total,
    effectiveRateOnMarketValue: input.marketValue ? total / input.marketValue : 0,
  };
}

// ---------------------------------------------------------------------------
// Income tax
// ---------------------------------------------------------------------------

function applyBrackets(taxable: USD, brackets: Bracket[]): USD {
  let tax = 0;
  let floor = 0;
  for (const b of brackets) {
    const ceiling = b.upTo ?? Infinity;
    if (taxable <= floor) break;
    tax += (Math.min(taxable, ceiling) - floor) * b.rate;
    floor = ceiling;
  }
  return tax;
}

export interface IncomeTaxInput {
  /** Resolve the correct base upstream — federal AGI vs federal taxable. */
  baseIncome: USD;
  household: Pick<Household, 'filingStatus' | 'age65Plus'>;
}

export interface IncomeTaxResult {
  taxableIncome: USD;
  stateTax: USD;
  localTax: USD;
  /** Rebates (CO TABOR) as a negative line, kept visible rather than netted. */
  surplusRebate: USD;
  total: USD;
  effectiveRate: Fraction;
}

export function computeIncomeTax(
  state: StateIncomeTax,
  local: LocalIncomeTax,
  input: IncomeTaxInput,
): IncomeTaxResult {
  const { baseIncome, household } = input;
  let taxableIncome = 0;
  let stateTax = 0;
  let surplusRebate = 0;

  if (state.kind !== 'none') {
    const deduction = state.standardDeduction[household.filingStatus] ?? 0;
    const exemption = state.personalExemption?.[household.filingStatus] ?? 0;
    const modifications = (state.modifications ?? []).reduce((sum, m) => {
      const applies =
        !m.appliesWhen ||
        m.appliesWhen === 'always' ||
        (m.appliesWhen === 'age65Plus' && household.age65Plus);
      if (!applies) return sum;
      return sum + (m.kind === 'subtraction' ? -m.amount : m.amount);
    }, 0);

    taxableIncome = Math.max(
      0,
      baseIncome - deduction - exemption + modifications,
    );

    stateTax =
      state.kind === 'flat'
        ? taxableIncome * state.rate
        : applyBrackets(taxableIncome, state.brackets[household.filingStatus]);

    if (state.kind === 'flat' && state.surplusRebate) {
      surplusRebate = state.surplusRebate.estimatedAnnual;
    }
  }

  let localTax = 0;
  switch (local.kind) {
    case 'none':
      break;
    case 'flatRate':
      localTax = baseIncome * local.rate;
      break;
    case 'graduated':
      localTax = applyBrackets(baseIncome, local.brackets);
      break;
    case 'headTax':
      localTax = local.usdPerMonth * 12 * local.employeeShare;
      break;
  }

  const total = stateTax + localTax - surplusRebate;
  return {
    taxableIncome,
    stateTax,
    localTax,
    surplusRebate,
    total,
    effectiveRate: baseIncome ? total / baseIncome : 0,
  };
}

// ---------------------------------------------------------------------------
// Sales tax
// ---------------------------------------------------------------------------

export function computeSalesTax(
  salesTax: SalesTax,
  spendByCategory: Partial<Record<SpendCategory, USD>>,
): { total: USD; byCategory: Partial<Record<SpendCategory, USD>> } {
  const byCategory: Partial<Record<SpendCategory, USD>> = {};

  for (const [key, spend] of Object.entries(spendByCategory)) {
    const category = key as SpendCategory;
    if (!spend) continue;

    const rate = salesTax.components.reduce((sum, c) => {
      if (c.exemptCategories.includes(category)) return sum;
      if (c.onlyCategories && !c.onlyCategories.includes(category)) return sum;
      return sum + c.rate;
    }, 0);

    byCategory[category] = spend * rate;
  }

  const total = Object.values(byCategory).reduce<USD>((s, v) => s + (v ?? 0), 0);
  return { total, byCategory };
}

// ---------------------------------------------------------------------------
// Vehicle tax
// ---------------------------------------------------------------------------

export function computeAnnualVehicleTax(
  costs: VehicleCosts,
  vehicles: Household['vehicles'],
): USD {
  const { tax } = costs;
  if (tax.kind === 'none') {
    return tax.annualRegistration * vehicles.length;
  }
  return vehicles.reduce((sum, v) => {
    const schedule = tax.rateByAgeYears;
    const rate = schedule[Math.min(v.ageYears, schedule.length - 1)] ?? 0;
    return sum + v.msrp * rate + tax.annualRegistration;
  }, 0);
}
