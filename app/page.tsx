/**
 * app/page.tsx
 *
 * Minimal shell — deliberately plain. The point of this page is to prove the
 * pipeline works end to end on Vercel: config loads, tax module computes,
 * housing module simulates. Styling comes after that's confirmed.
 *
 * Runs as a server component, so no data reaches the browser and no API keys
 * are ever exposed client-side.
 */

import { LOCALITIES, propertyTaxSystemFor, unverifiedFields } from '@/lib/tax/jurisdictions';
import { computePropertyTax } from '@/lib/tax/compute';
import { simulate, compare } from '@/lib/housing/scenarios';
import type { SimulationContext } from '@/lib/housing/scenarios';
import type { HousingScenario } from '@/lib/housing/types';
import { ASSUMPTIONS, HOUSEHOLD, SCENARIO_INPUTS } from '@/config/assumptions';

export const dynamic = 'force-dynamic';

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function analyze(localityId: string) {
  const inputs = SCENARIO_INPUTS[localityId];
  const system = propertyTaxSystemFor(localityId);

  const tax = computePropertyTax(system, {
    marketValue: inputs.buy.purchasePrice,
    hasHomestead: true,
    household: HOUSEHOLD,
  });

  const ctx: SimulationContext = {
    horizonYears: ASSUMPTIONS.horizonYears,
    market: ASSUMPTIONS.market,
    transaction: ASSUMPTIONS.transaction,
    federal: { ...ASSUMPTIONS.federal, stateIncomeTaxPaid: inputs.stateIncomeTaxPaid },
    propertyTaxSystem: system,
    hasHomestead: true,
    household: HOUSEHOLD,
    initialCapital: ASSUMPTIONS.initialCapital,
    referenceAnnualBudget: ASSUMPTIONS.referenceAnnualBudget,
  };

  const scenarios: HousingScenario[] = [
    { kind: 'rent', id: 'rent', rent: inputs.rent },
    { kind: 'buy', id: 'buy', buy: inputs.buy },
    { kind: 'rentThenBuy', id: 'hybrid', rentYears: 3, rent: inputs.rent, buy: inputs.buy },
  ];

  return {
    locality: LOCALITIES[localityId],
    propertyTax: tax,
    results: compare(scenarios.map((s) => simulate(s, ctx)), 'rent'),
  };
}

export default function Page() {
  const localityIds = Object.keys(SCENARIO_INPUTS);
  const analyses = localityIds.map(analyze);
  const unverified = unverifiedFields();

  return (
    <main style={{ fontFamily: 'ui-sans-serif, system-ui', padding: '2rem', maxWidth: 900, margin: '0 auto' }}>
      <h1>Cost comparison</h1>
      <p style={{ color: '#555' }}>
        {ASSUMPTIONS.horizonYears}-year horizon · {(ASSUMPTIONS.market.investmentReturn * 100).toFixed(1)}% assumed
        investment return · {(ASSUMPTIONS.market.homeAppreciation * 100).toFixed(1)}% appreciation
      </p>

      {unverified.length > 0 && (
        <div style={{ background: '#fff4e5', border: '1px solid #ffb74d', padding: '1rem', borderRadius: 6, margin: '1.5rem 0' }}>
          <strong>{unverified.length} unverified rate{unverified.length === 1 ? '' : 's'}.</strong>{' '}
          These are placeholders, not confirmed figures. Results below are not yet trustworthy.
          <ul style={{ marginBottom: 0 }}>
            {unverified.slice(0, 8).map((f) => (
              <li key={`${f.scope}.${f.field}`}>
                <code>{f.scope}.{f.field}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {analyses.map(({ locality, propertyTax, results }) => (
        <section key={locality.id} style={{ margin: '2rem 0' }}>
          <h2>{locality.city}, {locality.state}</h2>
          <p>
            Property tax on {money(SCENARIO_INPUTS[locality.id].buy.purchasePrice)}:{' '}
            <strong>{money(propertyTax.total)}/yr</strong>{' '}
            ({(propertyTax.effectiveRateOnMarketValue * 100).toFixed(2)}% effective)
          </p>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '0.5rem' }}>Scenario</th>
                <th style={{ padding: '0.5rem' }}>Year 1 net cost</th>
                <th style={{ padding: '0.5rem' }}>Net worth at horizon</th>
                <th style={{ padding: '0.5rem' }}>Breakeven</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.scenarioId} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.5rem' }}>{r.scenarioId}</td>
                  <td style={{ padding: '0.5rem' }}>{money(r.years[0]?.netHousingCost ?? 0)}</td>
                  <td style={{ padding: '0.5rem' }}>{money(r.terminalNetWorth)}</td>
                  <td style={{ padding: '0.5rem' }}>{r.breakevenYear ? `year ${r.breakevenYear}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <p style={{ color: '#777', fontSize: '0.9rem', marginTop: '3rem' }}>
        Not tax or financial advice. Confirm property tax figures against county assessor records
        before relying on any of this.
      </p>
    </main>
  );
}
