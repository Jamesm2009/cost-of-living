/**
 * lib/housing/mortgage.ts
 *
 * Monthly amortization, aggregated to years. Monthly granularity matters:
 * annualizing the interest formula overstates interest by roughly 1–2% of the
 * payment, which is enough to shift a marginal rent-vs-buy call.
 */

import type { Fraction, USD } from '../tax/types';
import type { AmortizationYear, LoanTerms } from './types';

/** Standard amortizing payment. Handles the 0% edge case. */
export function monthlyPayment(
  principal: USD,
  annualRate: Fraction,
  termYears: number,
): USD {
  const n = termYears * 12;
  if (n <= 0) return 0;
  const r = annualRate / 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

/**
 * Full schedule aggregated by year.
 *
 * PMI is charged on the ORIGINAL balance (the common servicer convention) and
 * drops once the loan-to-value ratio, measured against the CURRENT home value,
 * reaches the removal threshold. Appreciation therefore accelerates removal —
 * which is why homeValueByYear is a parameter rather than a constant.
 */
export function amortize(
  terms: LoanTerms,
  homeValueByYear: USD[],
): AmortizationYear[] {
  const { principal, annualRate, termYears } = terms;
  const pmiRate = terms.pmiAnnualRate ?? 0;
  const pmiRemovalLTV = terms.pmiRemovalLTV ?? 0.8;

  const payment = monthlyPayment(principal, annualRate, termYears);
  const r = annualRate / 12;

  const out: AmortizationYear[] = [];
  let balance = principal;

  for (let year = 1; year <= termYears; year++) {
    let interestPaid = 0;
    let principalPaid = 0;

    for (let m = 0; m < 12; m++) {
      if (balance <= 0) break;
      const interest = balance * r;
      // Final payment: never amortize below zero.
      const principalPortion = Math.min(payment - interest, balance);
      interestPaid += interest;
      principalPaid += principalPortion;
      balance -= principalPortion;
    }

    const homeValue = homeValueByYear[year - 1] ?? homeValueByYear.at(-1) ?? 0;
    const ltv = homeValue > 0 ? balance / homeValue : 1;
    const pmiPaid = pmiRate > 0 && ltv > pmiRemovalLTV ? principal * pmiRate : 0;

    out.push({
      year,
      interestPaid,
      principalPaid,
      pmiPaid,
      endingBalance: Math.max(0, balance),
    });

    if (balance <= 0) break;
  }

  return out;
}

/** Remaining balance after a whole number of years. */
export function balanceAfter(schedule: AmortizationYear[], year: number): USD {
  if (year <= 0) return schedule[0] ? schedule[0].endingBalance + schedule[0].principalPaid : 0;
  const row = schedule.find((s) => s.year === year);
  if (row) return row.endingBalance;
  return schedule.at(-1)?.endingBalance ?? 0;
}
