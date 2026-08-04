# Pricing changes to port into the Revenue Engine

The website's quote engine (`pricing.js`) started as a faithful port of
`priceStay()` from the Revenue Engine (`index.html`). Since then we've made
**three deliberate pricing changes on the website**. The Revenue Engine has
**not** been touched — these are the differences to apply there when you
redeploy it, so staff quotes and website quotes agree.

Verified against the engine before any changes: 1-month, 3-month, 6-month and
vacancy-gap scenarios all matched to the dollar.

---

## 0. Config must be kept in sync (no code change — just awareness)

The engine's live config differs from the `DEFAULTS` block in its own source
(someone tuned it via the Config tab). The website copies the **live** values.

Currently synced values (as of 2026-08-04):

| Setting | Live value | `DEFAULTS` in source |
|---|---|---|
| `seasonMarkup` Apr / May / Jun / Jul / Aug / Sep / Oct | .80 / .89 / 1.05 / 1.05 / .70 / .75 / .65 | .58 / .72 / .95 / 1.10 / .88 / .68 / .52 |
| `atDateFloorPeak` | 0.35 | 0.45 |
| `decayHorizon` | 75 | 60 |
| `decayAccelDays` | 15 | 14 |
| `losDiscount` | {1:0, 3:6, 6:15, 12:18} | {1:0, 3:4, 6:7, 12:10} |
| `endMonthWeight` | 0.7 | 0.6 |
| `vacancyRecover` | 70 | 80 |

**If you change engine config, re-sync `PRICING_CFG` in `pricing.js`** — open
the engine, sign in, run `JSON.stringify(CFG)` in the console, paste the values
across. Otherwise website quotes silently drift from staff quotes.

---

## 1. Long stays price off the months they occupy, not the move-in month

**Why:** the lead-time/decay branch replaced the whole seasonal calculation
with `decayedMarkup(..., moveInMonth, ...)` — the **move-in month alone**. So a
Dec 1 → Jun 30 stay was priced entirely off December's dead-season 0.35 markup
even though it runs through peak spring/summer (span-blended markup 0.60).
That badly under-priced long stays.

**Effect:** Thompson B, Dec 1 → Jun 30 went **$4,328/mo (23.7%) → $5,079/mo (45.1%)**.
Single-month stays are unchanged (span == move-in month), so the verified
1-month numbers still match exactly.

In `priceStay()`, step 5:

```js
// BEFORE
const decMarkup = decayedMarkup(opts.daysUntilAvailable, moveInMonth, CFG);

// AFTER — ask is the span-blended markup, floored/decayed as before
const ask = Math.max(spanMarkup, CFG.seasonMarkup[moveInMonth]);
const floor = atDateFloorMarkup(moveInMonth, CFG);
const decMarkup = floor + (ask - floor) * decayShape(opts.daysUntilAvailable, CFG);
```

`spanMarkup` is already computed in step 2 and is in scope.

---

## 2. Progressive burn-day (vacancy gap) charging

**Old rule:** flat `gapRent × vacancyRecover%` (70%).

**New rule**, charged progressively over the empty days between the home
opening up and the guest moving in, then spread across the stay:

- **first 14 days of the gap** → 85% of **base rent**
- **every day beyond that** → 92% of the **seasonal rate** for those dates

`CFG.vacancyRecover` becomes unused.

New constants + helper:

```js
const BURN_NEAR_DAYS = 14;   // length of tier 1, in days
const BURN_NEAR_RATE = 0.85; // tier 1: share of BASE RENT
const BURN_FAR_RATE  = 0.92; // tier 2: share of the SEASONAL rate

/* Span-blended seasonal rate for a window — no LOS, no decay, no gap recovery. */
function seasonalMonthlyFor(baseRent, from, to, CFG) {
  const fractions = spanMonthFractions(from, to);
  let markup = 0, any = false;
  for (const m in fractions) { markup += CFG.seasonMarkup[parseInt(m)] * fractions[m]; any = true; }
  if (!any) markup = CFG.seasonMarkup[from.getMonth() + 1];
  return baseRent * (1 + markup);
}
```

Replacing step 5b:

```js
let vacancyAdd = 0, vacancyPerMonth = 0, gapDays = 0;
if (opts.availableDate && opts.moveInForGap) {
  gapDays = daysBetween(opts.availableDate, opts.moveInForGap);
  if (gapDays > 0) {
    const availDate = opts.availableDate;
    const moveIn = opts.moveInForGap;
    const tierBoundary = gapDays <= BURN_NEAR_DAYS ? moveIn : addDays(availDate, BURN_NEAR_DAYS);

    // Tier 1 — first two weeks at 85% of base rent
    vacancyAdd = rentOwedBetween({ baseRent: baseRent * BURN_NEAR_RATE }, availDate, tierBoundary);

    // Tier 2 — the remainder at 92% of the seasonal rate for those dates
    if (moveIn > tierBoundary) {
      const seasonalMonthly = seasonalMonthlyFor(baseRent, tierBoundary, moveIn, CFG);
      vacancyAdd += rentOwedBetween({ baseRent: seasonalMonthly * BURN_FAR_RATE }, tierBoundary, moveIn);
    }

    vacancyPerMonth = months > 0 ? vacancyAdd / months : 0;
    perMonth += vacancyPerMonth;
  }
}
```

> Note the engine's `rentOwedBetween` takes a **unit object** (`{baseRent}`),
> while the website's takes a plain number. Signature shown above matches the
> engine.

Resulting burn charge, Thompson B ($3,500 base, 60-night stay):

| Gap | Added to rate |
|---|---|
| 0 days | +$0/mo |
| 7 days | +$352/mo |
| 14 days | +$704/mo |
| 21 days | +$1,238/mo |
| 29 days | +$1,848/mo |
| 45 days | +$2,985/mo |

---

## 3. 12-month stays: normal rules, floored at 20% markup

Twelve-month terms price on the **standard rules** (no flat rate). The only
addition is a floor so the length-of-stay discount can't cut an annual term
below a 20% markup over base.

Applied in `getPublicQuote()` after the normal `priceStay()` call:

```js
const LONG_STAY_MONTHS = 11.5;      // months
const LONG_STAY_MIN_MARKUP = 0.20;  // never quote an annual term below this

if (months >= LONG_STAY_MONTHS) {
  perMonth = Math.max(perMonth, baseRent * (1 + LONG_STAY_MIN_MARKUP));
}
```

In practice the floor rarely binds — with the change in §1, 12-month quotes for
Thompson B come out at 35–44% depending on move-in month, well clear of 20%.

---

## Worth sanity-checking

**A far-future move-in produces a very large burn-day charge.** A 12-month stay
starting Jun 1 2027 on a home that opened Nov 2 2026 carries a 211-day gap; the
burn rule spreads all of it across the stay and pushes the quote to ~147% markup.
That is the rule working as specified, and the "Move in when it opens"
recommendation steers guests away from it — but you may want a cap, or to stop
charging burn days past some horizon (the home would realistically be re-let in
the interim). Say the word and it's a small change.

## Open question

For tier 2 of the burn-day rule you first said *92% of the seasonal rate*, then
later said *85% of the nightly rate we would charge*. This is currently built
as **92%** (`BURN_FAR_RATE`). If it should be 85%, it's a one-line change in
both files.
