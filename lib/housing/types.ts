/**
 * lib/housing/types.ts
 *
 * The housing module runs a YEAR-BY-YEAR simulation rather than a single
 * steady-state calculation. That is not over-engineering: property tax caps
 * (TX 10%, FL 3%) compound, rent escalates, mortgage interest decays, and the
 * itemization threshold flips partway through most mortgages. A one-shot
 * "monthly cost" comparison gets all four wrong.
 */

import type { Fraction, USD } from '../tax/types';

// ---------------------------------------------------------------------------
// Market assumptions
// ---------------------------------------------------------------------------

export interface MarketAssumptions {
  /** Annual home price appreciation. Per-metro — do not use one national number. */
  homeAppreciation: Fraction;
  /** Annual rent escalation. */
  rentGrowth: Fraction;
  /** General inflation, applied to insurance, HOA, maintenance. */
  inflation: Fraction;
  /**
   * Return on money NOT tied up in a down payment. This is the single most
   * outcome-determining assumption in the whole model — a 7% assumption and a
   * 4% assumption routinely flip rent vs buy. Expose it as a slider, and never
   * bury it in a constant.
   */
  investmentReturn: Fraction;
  /** Discount rate for NPV. Often set equal to investmentReturn. */
  discountRate: Fraction;
}

export interface TransactionCosts {
  /** Closing costs on purchase, as a fraction of price. Typically 0.02–0.03. */
  buyRate: Fraction;
  /** Costs on sale: agent commission, title, transfer. Typically 0.06–0.08. */
  sellRate: Fraction;
}

// ---------------------------------------------------------------------------
// Federal tax context (state/local tax comes from lib/tax)
// ---------------------------------------------------------------------------

export interface FederalTaxContext {
  /** Marginal federal rate used to value deductions. */
  marginalRate: Fraction;
  /** Federal standard deduction for the filing status. */
  standardDeduction: USD;
  /**
   * SALT deduction cap. Raised substantially for 2025–2029 with a high-income
   * phasedown. VERIFY for the tax year — this materially changes how much of a
   * Texas property tax bill is actually deductible.
   */
  saltCap: USD;
  /** Charitable, etc. Counts toward clearing the standard deduction hurdle. */
  otherItemizedDeductions: USD;
  /** State income tax paid — competes with property tax under the SALT cap. */
  stateIncomeTaxPaid: USD;
}

// ---------------------------------------------------------------------------
// Loan
// ---------------------------------------------------------------------------

export interface LoanTerms {
  principal: USD;
  annualRate: Fraction;
  termYears: number;
  /**
   * PMI as a fraction of the ORIGINAL loan balance, charged annually until
   * the loan-to-value ratio reaches pmiRemovalLTV.
   */
  pmiAnnualRate?: Fraction;
  pmiRemovalLTV?: Fraction;
}

export interface AmortizationYear {
  year: number;
  interestPaid: USD;
  principalPaid: USD;
  pmiPaid: USD;
  endingBalance: USD;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export interface RentInputs {
  monthlyRent: USD;
  rentersInsuranceAnnual: USD;
  /** Utilities the renter pays that an owner would also pay: exclude these to
   *  avoid double counting. Include only renter-specific costs here. */
  monthlyOtherAnnual?: USD;
  securityDepositMonths?: number;
}

export interface BuyInputs {
  purchasePrice: USD;
  downPayment: USD;
  mortgageRate: Fraction;
  termYears: number;
  /**
   * Get a real quote. Formula-based estimates are badly wrong in FL (wind) and
   * TX (hail), which are exactly the markets where this line decides the answer.
   */
  homeownersInsuranceAnnual: USD;
  hoaMonthly: USD;
  /** Annual maintenance as a fraction of home value. 0.01 is the common rule. */
  maintenanceRateOfValue: Fraction;
  pmiAnnualRate?: Fraction;
}

export type HousingScenario =
  | { kind: 'rent'; id: string; rent: RentInputs }
  | { kind: 'buy'; id: string; buy: BuyInputs }
  | {
      kind: 'rentThenBuy';
      id: string;
      rentYears: number;
      rent: RentInputs;
      /**
       * Purchase price is inflated by homeAppreciation over rentYears at run
       * time — supply TODAY's price here, not a guess at the future one.
       */
      buy: BuyInputs;
    };

// ---------------------------------------------------------------------------
// Simulation output
// ---------------------------------------------------------------------------

export interface HousingYear {
  year: number;
  /** Cash out the door for housing this year, before any tax benefit. */
  grossHousingCost: USD;
  /** Components, for a stacked chart and for sanity-checking. */
  breakdown: {
    rent: USD;
    mortgageInterest: USD;
    mortgagePrincipal: USD;
    propertyTax: USD;
    insurance: USD;
    hoa: USD;
    maintenance: USD;
    pmi: USD;
    transactionCosts: USD;
  };
  /**
   * Value of itemizing over taking the standard deduction, times the marginal
   * rate. Zero for most buyers in low-tax states — which is the point.
   */
  federalTaxBenefit: USD;
  netHousingCost: USD;
  /** Market value of the home, or 0 when renting. */
  homeValue: USD;
  mortgageBalance: USD;
  /** homeValue − mortgageBalance. Not yet net of selling costs. */
  grossEquity: USD;
  /** Side portfolio: capital not spent on housing, compounded. */
  portfolioValue: USD;
  /** grossEquity − hypothetical selling costs + portfolioValue. */
  netWorth: USD;
}

export interface HousingResult {
  scenarioId: string;
  kind: HousingScenario['kind'];
  years: HousingYear[];
  /** Sum of netHousingCost, discounted to today. */
  npvOfCosts: USD;
  /** Net worth at the horizon, assuming you liquidate. */
  terminalNetWorth: USD;
  /** First year where buying's cumulative net worth overtakes renting's. */
  breakevenYear: number | null;
}
