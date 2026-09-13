/**
 * lib/housing/scenarios.ts
 *
 * The engine. Simulates rent / buy / rentThenBuy year by year and returns a
 * comparable net-worth path for each.
 *
 * Fair-comparison method (the NYT approach): every scenario is charged against
 * the SAME annual housing budget and the SAME starting capital. Whatever a
 * scenario doesn't spend goes into a side portfolio earning investmentReturn.
 * Without this, buying always looks better simply because principal payments
 * are savings disguised as costs.
 */

import type { Fraction, USD } from '../tax/types';
import type { PropertyTaxSystem } from '../tax/types';
import { computePropertyTax } from '../tax/compute';
import { amortize, monthlyPayment } from './mortgage';
import type {
  BuyInputs,
  FederalTaxContext,
  HousingResult,
  HousingScenario,
  HousingYear,
  MarketAssumptions,
  RentInputs,
  TransactionCosts,
} from './types';

export interface SimulationContext {
  horizonYears: number;
  market: MarketAssumptions;
  transaction: TransactionCosts;
  federal: FederalTaxContext;
  propertyTaxSystem: PropertyTaxSystem;
  hasHomestead: boolean;
  household: { age65Plus: boolean; disabled: boolean; veteran: boolean };
  /** Capital on hand at t=0 — the money a buyer would put down. */
  initialCapital: USD;
  /**
   * Common annual budget every scenario is measured against. Set it to the
   * most expensive scenario's first-year cost, or to your actual housing
   * budget. Only relative differences matter.
   */
  referenceAnnualBudget: USD;
}

const emptyBreakdown = (): HousingYear['breakdown'] => ({
  rent: 0,
  mortgageInterest: 0,
  mortgagePrincipal: 0,
  propertyTax: 0,
  insurance: 0,
  hoa: 0,
  maintenance: 0,
  pmi: 0,
  transactionCosts: 0,
});

/**
 * Threads prior-year assessed value through the tax pipeline so growth caps
 * actually compound. This is the whole reason the cap lives in the tax model:
 * in TX and FL a long hold diverges meaningfully from market value.
 */
function propertyTaxPath(
  system: PropertyTaxSystem,
  ctx: SimulationContext,
  homeValueByYear: USD[],
): USD[] {
  let priorAssessed: USD | undefined = undefined;
  return homeValueByYear.map((marketValue) => {
    const r = computePropertyTax(system, {
      marketValue,
      priorAssessedValue: priorAssessed,
      hasHomestead: ctx.hasHomestead,
      household: ctx.household,
    });
    priorAssessed = r.cappedValue;
    return r.total;
  });
}

/** Value of itemizing, relative to just taking the standard deduction. */
function federalBenefit(
  mortgageInterest: USD,
  propertyTax: USD,
  federal: FederalTaxContext,
): USD {
  const saltEligible = propertyTax + federal.stateIncomeTaxPaid;
  const salt = Math.min(saltEligible, federal.saltCap);
  const itemized = mortgageInterest + salt + federal.otherItemizedDeductions;
  const excess = Math.max(0, itemized - federal.standardDeduction);
  return excess * federal.marginalRate;
}

function grow(base: USD, rate: Fraction, years: number): USD {
  return base * Math.pow(1 + rate, years);
}

/** Build the ownership portion of a path, starting at `startYear` (1-indexed). */
function ownershipYears(
  buy: BuyInputs,
  ctx: SimulationContext,
  startYear: number,
  priceAtPurchase: USD,
): HousingYear[] {
  const { market, transaction, federal } = ctx;
  const ownedYears = ctx.horizonYears - startYear + 1;
  if (ownedYears <= 0) return [];

  const homeValueByYear = Array.from({ length: ownedYears }, (_, i) =>
    grow(priceAtPurchase, market.homeAppreciation, i + 1),
  );

  const downPayment = Math.min(buy.downPayment, priceAtPurchase);
  const loanPrincipal = priceAtPurchase - downPayment;

  const schedule = amortize(
    {
      principal: loanPrincipal,
      annualRate: buy.mortgageRate,
      termYears: buy.termYears,
      pmiAnnualRate: buy.pmiAnnualRate,
      pmiRemovalLTV: 0.8,
    },
    homeValueByYear,
  );

  const taxes = propertyTaxPath(ctx.propertyTaxSystem, ctx, homeValueByYear);
  const closingCost = priceAtPurchase * transaction.buyRate;

  return Array.from({ length: ownedYears }, (_, i) => {
    const year = startYear + i;
    const row = schedule[i];
    const homeValue = homeValueByYear[i];
    const yearsSinceStart = i;

    const breakdown = emptyBreakdown();
    breakdown.mortgageInterest = row?.interestPaid ?? 0;
    breakdown.mortgagePrincipal = row?.principalPaid ?? 0;
    breakdown.pmi = row?.pmiPaid ?? 0;
    breakdown.propertyTax = taxes[i] ?? 0;
    breakdown.insurance = grow(
      buy.homeownersInsuranceAnnual,
      market.inflation,
      yearsSinceStart,
    );
    breakdown.hoa = grow(buy.hoaMonthly * 12, market.inflation, yearsSinceStart);
    breakdown.maintenance = homeValue * buy.maintenanceRateOfValue;
    breakdown.transactionCosts = i === 0 ? closingCost : 0;

    const grossHousingCost =
      breakdown.mortgageInterest +
      breakdown.mortgagePrincipal +
      breakdown.pmi +
      breakdown.propertyTax +
      breakdown.insurance +
      breakdown.hoa +
      breakdown.maintenance +
      breakdown.transactionCosts;

    const taxBenefit = federalBenefit(
      breakdown.mortgageInterest,
      breakdown.propertyTax,
      federal,
    );

    const mortgageBalance = row?.endingBalance ?? 0;

    return {
      year,
      grossHousingCost,
      breakdown,
      federalTaxBenefit: taxBenefit,
      netHousingCost: grossHousingCost - taxBenefit,
      homeValue,
      mortgageBalance,
      grossEquity: homeValue - mortgageBalance,
      portfolioValue: 0, // filled in by the portfolio pass
      netWorth: 0,
    };
  });
}

function rentalYears(
  rent: RentInputs,
  ctx: SimulationContext,
  startYear: number,
  endYear: number,
): HousingYear[] {
  const { market } = ctx;
  const count = endYear - startYear + 1;
  if (count <= 0) return [];

  return Array.from({ length: count }, (_, i) => {
    const year = startYear + i;
    const breakdown = emptyBreakdown();
    breakdown.rent = grow(rent.monthlyRent * 12, market.rentGrowth, i);
    breakdown.insurance = grow(
      rent.rentersInsuranceAnnual + (rent.monthlyOtherAnnual ?? 0),
      market.inflation,
      i,
    );

    const grossHousingCost = breakdown.rent + breakdown.insurance;

    return {
      year,
      grossHousingCost,
      breakdown,
      federalTaxBenefit: 0, // renting yields no federal housing deduction
      netHousingCost: grossHousingCost,
      homeValue: 0,
      mortgageBalance: 0,
      grossEquity: 0,
      portfolioValue: 0,
      netWorth: 0,
    };
  });
}

export function simulate(
  scenario: HousingScenario,
  ctx: SimulationContext,
): HousingResult {
  const { market, transaction } = ctx;

  let years: HousingYear[];
  let upfrontCapitalUsed = 0;

  switch (scenario.kind) {
    case 'rent': {
      years = rentalYears(scenario.rent, ctx, 1, ctx.horizonYears);
      break;
    }
    case 'buy': {
      years = ownershipYears(scenario.buy, ctx, 1, scenario.buy.purchasePrice);
      upfrontCapitalUsed = Math.min(
        scenario.buy.downPayment,
        scenario.buy.purchasePrice,
      );
      break;
    }
    case 'rentThenBuy': {
      const n = Math.min(scenario.rentYears, ctx.horizonYears);
      const rentPart = rentalYears(scenario.rent, ctx, 1, n);
      // Buy at the FUTURE price. Supplying today's price and ignoring drift is
      // the most common error in hybrid scenarios.
      const futurePrice = grow(
        scenario.buy.purchasePrice,
        market.homeAppreciation,
        n,
      );
      const buyPart = ownershipYears(scenario.buy, ctx, n + 1, futurePrice);
      years = [...rentPart, ...buyPart];
      break;
    }
  }

  // ---- Portfolio pass -----------------------------------------------------
  // Capital not committed to a down payment stays invested. Each year, the
  // difference between the reference budget and this scenario's net cost is
  // contributed (or withdrawn, if negative).
  let portfolio = ctx.initialCapital - upfrontCapitalUsed;
  let breakevenYear: number | null = null;

  for (const y of years) {
    // rentThenBuy commits the down payment at the moment of purchase.
    if (
      scenario.kind === 'rentThenBuy' &&
      y.year === Math.min(scenario.rentYears, ctx.horizonYears) + 1
    ) {
      portfolio -= Math.min(scenario.buy.downPayment, portfolio);
    }

    portfolio *= 1 + market.investmentReturn;
    portfolio += ctx.referenceAnnualBudget - y.netHousingCost;

    const sellingCost = y.homeValue * transaction.sellRate;
    y.portfolioValue = portfolio;
    y.netWorth = portfolio + Math.max(0, y.grossEquity - sellingCost);
  }

  const npvOfCosts = years.reduce(
    (sum, y) =>
      sum + y.netHousingCost / Math.pow(1 + market.discountRate, y.year),
    0,
  );

  return {
    scenarioId: scenario.id,
    kind: scenario.kind,
    years,
    npvOfCosts,
    terminalNetWorth: years.at(-1)?.netWorth ?? 0,
    breakevenYear,
  };
}

/**
 * Compare scenarios and fill in breakeven years relative to a baseline
 * (normally the pure-rent scenario).
 */
export function compare(
  results: HousingResult[],
  baselineId: string,
): HousingResult[] {
  const baseline = results.find((r) => r.scenarioId === baselineId);
  if (!baseline) return results;

  for (const r of results) {
    if (r.scenarioId === baselineId) continue;
    const hit = r.years.find((y) => {
      const base = baseline.years.find((b) => b.year === y.year);
      return base ? y.netWorth > base.netWorth : false;
    });
    r.breakevenYear = hit?.year ?? null;
  }
  return results;
}

export { monthlyPayment };
