/**
 * tax-types.ts
 *
 * Jurisdiction-agnostic tax model for a cost-of-living comparison tool.
 *
 * Design principle: no state-specific branching in the type system. Every state
 * is a *configuration* of a shared pipeline. Adding Ohio should mean adding a
 * config object, never editing a type or an evaluator.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** US dollars. Always annual unless the field name says otherwise. */
export type USD = number;

/** A tax rate expressed as a fraction: 0.044 === 4.4%. */
export type Fraction = number;

export type StateCode =
  | 'AL' | 'AK' | 'AZ' | 'AR' | 'CA' | 'CO' | 'CT' | 'DE' | 'FL' | 'GA'
  | 'HI' | 'ID' | 'IL' | 'IN' | 'IA' | 'KS' | 'KY' | 'LA' | 'ME' | 'MD'
  | 'MA' | 'MI' | 'MN' | 'MS' | 'MO' | 'MT' | 'NE' | 'NV' | 'NH' | 'NJ'
  | 'NM' | 'NY' | 'NC' | 'ND' | 'OH' | 'OK' | 'OR' | 'PA' | 'RI' | 'SC'
  | 'SD' | 'TN' | 'TX' | 'UT' | 'VT' | 'VA' | 'WA' | 'WV' | 'WI' | 'WY'
  | 'DC';

export type FilingStatus =
  | 'single'
  | 'marriedJoint'
  | 'marriedSeparate'
  | 'headOfHousehold';

export type ByFilingStatus<T> = Record<FilingStatus, T>;

/**
 * Property tax rates are quoted in three incompatible conventions depending on
 * the state. Carry the unit with the number so the evaluator can normalize,
 * rather than silently assuming one and being wrong by 10x.
 *
 *   mills      — per $1,000 of taxable value (CO, FL)
 *   perHundred — per $100 of taxable value (NC, TX)
 *   fraction   — 0.021 === 2.1%
 */
export type RateUnit = 'mills' | 'perHundred' | 'fraction';

export interface Rate {
  value: number;
  unit: RateUnit;
}

/**
 * Every rate in this system is wrapped. Tax rates change annually, vary by
 * parcel, and aggregator sites disagree with each other. An unwrapped number
 * is a number you can't audit later.
 */
export interface Sourced<T> {
  value: T;
  /** URL of the authoritative source — assessor, DOR, statute. Not a blog. */
  source: string;
  /** ISO date the rate took effect. */
  effectiveDate: string;
  /** ISO date a human last confirmed it. Stale = show a warning in the UI. */
  verifiedOn: string | null;
  note?: string;
}

// ---------------------------------------------------------------------------
// Income tax
// ---------------------------------------------------------------------------

/**
 * What the state starts from. Matters more than people expect: CO begins at
 * federal *taxable* income (so you inherit the federal standard deduction),
 * while NC begins at federal AGI and applies its own deduction.
 */
export type IncomeTaxBase =
  | 'federalAGI'
  | 'federalTaxableIncome'
  | 'stateGrossWithModifications';

export interface Bracket {
  /** Upper bound of this bracket. null === no ceiling (top bracket). */
  upTo: USD | null;
  rate: Fraction;
}

/** Additions and subtractions applied between the base and taxable income. */
export interface IncomeModification {
  id: string;
  label: string;
  kind: 'subtraction' | 'addition';
  /** Fixed amount, or a predicate resolved by the caller for income-dependent rules. */
  amount: USD;
  appliesWhen?: 'always' | 'age65Plus' | 'retirementIncome' | 'socialSecurity';
}

export type StateIncomeTax =
  | { kind: 'none' }
  | {
      kind: 'flat';
      base: IncomeTaxBase;
      rate: Fraction;
      standardDeduction: ByFilingStatus<USD>;
      personalExemption?: ByFilingStatus<USD>;
      modifications?: IncomeModification[];
      /**
       * Mechanisms that rebate tax after the fact (CO's TABOR). Modeled as a
       * separate credit rather than a rate adjustment, because it's lumpy and
       * year-dependent — do not fold it into `rate`.
       */
      surplusRebate?: { label: string; estimatedAnnual: USD };
    }
  | {
      kind: 'graduated';
      base: IncomeTaxBase;
      brackets: ByFilingStatus<Bracket[]>;
      standardDeduction: ByFilingStatus<USD>;
      personalExemption?: ByFilingStatus<USD>;
      modifications?: IncomeModification[];
    };

/**
 * Local income tax. Zero in most of the country, but real in PA, OH, MD, NYC,
 * MI, IN, KY, MO, OR. Colorado's version is a flat dollar head tax in five
 * cities (Denver, Aurora, Greenwood Village, Glendale, Sheridan) — Colorado
 * Springs has none, but the field must exist for the model to generalize.
 */
export type LocalIncomeTax =
  | { kind: 'none' }
  | { kind: 'flatRate'; rate: Fraction; base: IncomeTaxBase }
  | { kind: 'graduated'; brackets: Bracket[]; base: IncomeTaxBase }
  | { kind: 'headTax'; usdPerMonth: USD; employeeShare: Fraction };

// ---------------------------------------------------------------------------
// Property tax — the shared valuation pipeline
// ---------------------------------------------------------------------------

/**
 * Which layer of government levies. Exemptions target these classes, which is
 * how TX (school-only $140k) and FL (second $25k excludes school) are expressed
 * without either state needing bespoke logic.
 */
export type LevyClass =
  | 'school'
  | 'county'
  | 'municipal'
  | 'special'; // hospital, college, transit, fire, library

export interface Levy {
  jurisdiction: string;
  levyClass: LevyClass;
  rate: Rate;
}

/** Stage 1: market value → assessed value. */
export interface AssessmentRule {
  /**
   * Fraction of market value that becomes assessed value.
   * ~0.0625 in CO; 1.0 in TX, NC, FL.
   */
  residentialAssessmentRatio: Fraction;
  /** Years between mandated revaluations. NC runs 4–8; TX and FL are annual. */
  revaluationCycleYears: number;
}

/** Stage 2: annual growth cap on assessed value. */
export interface ValueCap {
  label: string;
  /** 0.10 for TX §23.23; 0.03 for FL Save Our Homes. */
  maxAnnualIncrease: Fraction;
  requiresHomestead: boolean;
  /** FL lets you carry accrued SOH savings to a new home. Most states don't. */
  portable: boolean;
  /** Cap resets to market value on sale. Drives the "recent buyer" penalty. */
  resetsOnTransfer: boolean;
}

/** Stage 3: exemptions. */
export type ExemptionAmount =
  | { kind: 'fixed'; amount: USD }
  | { kind: 'percentOfValue'; percent: Fraction; floor?: USD; cap?: USD }
  /** FL: $0–25k exempt everywhere, $25–50k not exempt, $50–75k exempt from non-school. */
  | { kind: 'bandedFixed'; bands: { from: USD; to: USD | null; exempt: boolean }[] };

export type ExemptionEligibility =
  | 'general'
  | 'age65Plus'
  | 'disabled'
  | 'veteran'
  | 'survivingSpouse';

export interface Exemption {
  id: string;
  label: string;
  amount: ExemptionAmount;
  /** Empty array === applies to every levy class. */
  appliesTo: LevyClass[];
  requiresHomestead: boolean;
  eligibility: ExemptionEligibility;
  /** FL Amendment 5 indexes the second $25k band to inflation. */
  inflationIndexed?: boolean;
  /** TX over-65 also freezes the school levy dollar amount. */
  freezesLevyAmount?: boolean;
}

export interface PropertyTaxSystem {
  assessment: AssessmentRule;
  valueCap?: ValueCap;
  exemptions: Exemption[];
  levies: Levy[];
  /**
   * Parcel-level add-ons invisible in county averages and the single largest
   * source of error in this whole model: TX MUDs and PIDs, CO metro districts,
   * FL CDDs. Always surface these as a manual override in the UI.
   */
  supplementalDistricts: Levy[];
}

// ---------------------------------------------------------------------------
// Sales tax
// ---------------------------------------------------------------------------

export type SpendCategory =
  | 'groceries'
  | 'preparedFood'
  | 'clothing'
  | 'generalGoods'
  | 'prescriptionDrugs'
  | 'services'
  | 'vehicles'
  | 'utilities';

export interface SalesTaxComponent {
  jurisdiction: string;
  rate: Fraction;
  /** Categories this component does NOT tax. */
  exemptCategories: SpendCategory[];
  /**
   * FL caps its county discretionary surtax at the first $5,000 of a single
   * item — matters for cars and appliances, nothing else.
   */
  perItemTaxableCap?: USD;
  /**
   * NC's trap: the state exempts groceries but a 2% local food tax still
   * applies. Expressed as a component that taxes ONLY groceries.
   */
  onlyCategories?: SpendCategory[];
}

export interface FlatConsumptionFee {
  label: string;
  usdPerOrder: USD;
  appliesTo: SpendCategory[];
  expiresOn?: string;
}

export interface SalesTax {
  components: SalesTaxComponent[];
  flatFees?: FlatConsumptionFee[];
}

// ---------------------------------------------------------------------------
// Vehicle tax
// ---------------------------------------------------------------------------

/**
 * Structurally a property tax on cars, and a genuine offset to CO's and NC's
 * low real-property rates. Easy to miss; worth its own node.
 */
export type VehicleTax =
  | { kind: 'none'; annualRegistration: USD }
  | {
      kind: 'annualValueBased';
      label: string;
      basis: 'msrp' | 'marketValue' | 'assessedValue';
      /** Index = vehicle age in years. Value = fraction of basis owed. */
      rateByAgeYears: Fraction[];
      annualRegistration: USD;
    };

export interface VehicleCosts {
  tax: VehicleTax;
  /** One-time at purchase, separate from the annual tax. */
  purchaseSalesTaxRate: Fraction;
  oneTimeTitleAndFees: USD;
}

// ---------------------------------------------------------------------------
// Jurisdiction profiles
// ---------------------------------------------------------------------------

export interface StateProfile {
  code: StateCode;
  name: string;
  incomeTax: Sourced<StateIncomeTax>;
  /** Statewide framework. Localities supply their own levies and exemptions. */
  propertyFramework: Sourced<{
    assessment: AssessmentRule;
    valueCap?: ValueCap;
    statewideExemptions: Exemption[];
  }>;
  stateSalesTax: Sourced<SalesTaxComponent>;
  vehicle: Sourced<VehicleCosts>;
}

export interface LocalityProfile {
  id: string;
  city: string;
  county: string;
  state: StateCode;
  localIncomeTax: Sourced<LocalIncomeTax>;
  localSalesTax: Sourced<SalesTaxComponent[]>;
  propertyLevies: Sourced<Levy[]>;
  localExemptions: Sourced<Exemption[]>;
  supplementalDistricts: Sourced<Levy[]>;
}

// ---------------------------------------------------------------------------
// Household inputs
// ---------------------------------------------------------------------------

export interface Household {
  filingStatus: FilingStatus;
  grossIncomeByCity: Record<string, USD>;
  age65Plus: boolean;
  disabled: boolean;
  veteran: boolean;
  vehicles: { msrp: USD; ageYears: number }[];
  /** Annual spend by category, from your own bank statements. */
  spendByCategory: Partial<Record<SpendCategory, USD>>;
}

export type HousingScenario =
  | { kind: 'rent'; monthlyRent: USD; rentersInsuranceAnnual: USD }
  | {
      kind: 'buy';
      purchasePrice: USD;
      downPayment: USD;
      mortgageRate: Fraction;
      termYears: number;
      /** Get real quotes. Formulas are badly wrong in FL and TX. */
      homeownersInsuranceAnnual: USD;
      hoaMonthly: USD;
      maintenanceRateOfValue: Fraction;
      /** Years held. Drives the cap benefit and transaction cost amortization. */
      horizonYears: number;
    }
  | {
      kind: 'rentThenBuy';
      rentYears: number;
      rent: Extract<HousingScenario, { kind: 'rent' }>;
      buy: Extract<HousingScenario, { kind: 'buy' }>;
      /** Assumed annual home price appreciation while renting. */
      appreciationRate: Fraction;
    };
