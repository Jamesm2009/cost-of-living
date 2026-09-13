/**
 * config/assumptions.ts
 *
 * THIS IS THE FILE YOU EDIT. Everything here is your situation, not the model.
 *
 * The single most consequential number is `investmentReturn`. It decides rent
 * vs buy more often than any tax rate does. At 7% renting usually wins; at 4%
 * buying often does. Do not treat it as a technical detail.
 */

import type { MarketAssumptions, TransactionCosts, BuyInputs, RentInputs } from '@/lib/housing/types';

export const HOUSEHOLD = {
  age65Plus: false,
  disabled: false,
  veteran: false,
};

export const ASSUMPTIONS = {
  horizonYears: 10,

  /** Money you have available today — what a buyer would put down. */
  initialCapital: 90_000,

  /**
   * Common annual housing budget every scenario is measured against.
   * Only relative differences matter; set it near your actual budget.
   */
  referenceAnnualBudget: 48_000,

  market: {
    homeAppreciation: 0.035,
    rentGrowth: 0.03,
    inflation: 0.025,
    investmentReturn: 0.07, // ← the lever. Try 0.04 and watch the answer flip.
    discountRate: 0.07,
  } satisfies MarketAssumptions,

  transaction: {
    buyRate: 0.025,
    sellRate: 0.07,
  } satisfies TransactionCosts,

  federal: {
    marginalRate: 0.22,
    standardDeduction: 30_000,
    /** VERIFY for your tax year — the SALT cap changed recently. */
    saltCap: 40_000,
    otherItemizedDeductions: 3_000,
  },
};

interface CityInputs {
  rent: RentInputs;
  buy: BuyInputs;
  /** Annual state income tax — competes with property tax under the SALT cap. */
  stateIncomeTaxPaid: number;
}

/** Your real numbers per city. Insurance especially: get actual quotes. */
export const SCENARIO_INPUTS: Record<string, CityInputs> = {
  'fort-worth-tx': {
    rent: { monthlyRent: 1_900, rentersInsuranceAnnual: 220 },
    buy: {
      purchasePrice: 400_000,
      downPayment: 80_000,
      mortgageRate: 0.0625,
      termYears: 30,
      homeownersInsuranceAnnual: 4_200, // TX hail exposure — quote this
      hoaMonthly: 0,
      maintenanceRateOfValue: 0.01,
      pmiAnnualRate: 0.006,
    },
    stateIncomeTaxPaid: 0,
  },
  'colorado-springs-co': {
    rent: { monthlyRent: 1_950, rentersInsuranceAnnual: 220 },
    buy: {
      purchasePrice: 450_000,
      downPayment: 80_000,
      mortgageRate: 0.0625,
      termYears: 30,
      homeownersInsuranceAnnual: 2_100,
      hoaMonthly: 0,
      maintenanceRateOfValue: 0.01,
      pmiAnnualRate: 0.006,
    },
    stateIncomeTaxPaid: 3_700,
  },
};
