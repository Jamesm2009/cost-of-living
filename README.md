# cost-compare

Personalized cost-of-living comparison across US metros. Models rent vs buy vs
rent-then-buy with real state and local tax treatment.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in your keys
npm run dev
```

Visit http://localhost:3000

## Deploying

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project → Import** your repo. Framework auto-detects
   as Next.js; accept the defaults.
3. Add every variable from `.env.example` under **Settings → Environment
   Variables**. The app builds without them but `/api/refresh` will fail.
4. Deploy. Every later `git push` redeploys automatically.

The weekly cron in `vercel.json` runs Mondays at 06:00 UTC. Cron requires a Pro
plan; on Hobby, hit `/api/refresh` manually or from an external scheduler.

Test the refresh route by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/refresh
```

## Editing your numbers

**`config/assumptions.ts`** — your situation: prices, rents, down payment,
horizon, insurance quotes. Start here.

The most consequential value in the whole project is `investmentReturn`. It
decides rent vs buy more often than any tax rate. At 7% renting usually wins;
at 4% buying often does. Treat it as a real assumption, not a default.

**`data/states/*.json`** and **`data/localities/*.json`** — tax rates. You do
not edit TypeScript to change a rate. Change the number, then set that field's
`verifiedOn` to today's date (`"2026-09-12"` format).

A typo fails the build with a message naming the exact field. That's
deliberate — a wrong rate that silently computes is far worse than a build error.

```bash
npm run verify-rates    # lists every unconfirmed rate
```

## Layout

```
app/           page.tsx · api/refresh/route.ts (cron target)
config/        assumptions.ts          ← YOUR NUMBERS
data/          states/*.json · localities/*.json   ← THE RATES
lib/tax/       types · schema · compute · jurisdictions    (pure)
lib/housing/   types · mortgage · scenarios                (pure)
lib/cache/     redis.ts                                    (Upstash)
lib/data/      http · metros · refresh · sources/*         (external APIs)
scripts/       verify-rates.ts
```

`lib/tax` and `lib/housing` are pure functions — no I/O, no keys, no network.
Only `lib/cache` and `lib/data` touch the outside world.

## Method

Year-by-year simulation, not a monthly average. Four things compound and a
steady-state calculation gets them all wrong: property tax growth caps, rent
escalation, mortgage interest decay, and the itemization threshold flipping
mid-mortgage.

Scenarios are compared on equal footing — same annual budget, same starting
capital, with unspent money compounding in a side portfolio. Without that,
buying always wins trivially because mortgage principal is savings disguised
as a cost.

## Status

**Structural rules are researched and correct** — exemption shapes, growth
caps, rate conventions, which levy classes each exemption targets.

**Specific rates are placeholders.** Mill levies, local rates, and all metro
geography codes in `lib/data/metros.ts` need confirming against assessor and
Census sources before any output is trustworthy. Run `npm run verify-rates`.

**API endpoint shapes are unverified.** The Census, HUD, BLS, BEA, and EIA
calls follow documented APIs but were written without network access to test
them. Expect to adjust parsing on first run. The Zillow CSV URLs are the most
fragile part — Zillow relocates those files periodically. If refreshes start
failing, check https://www.zillow.com/research/data/ first.

Not tax or financial advice.

