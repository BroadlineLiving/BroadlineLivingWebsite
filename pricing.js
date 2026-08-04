/* ============================================================
   BROADLINE LIVING — PUBLIC QUOTE ENGINE
   Ported from the internal Revenue Engine's priceStay() so guest
   quotes on the website match staff-facing pricing exactly.

   This file intentionally omits the internal negotiation tools
   (dynamic annual-target floor, negotiation range, P/L tracking) —
   those are staff-only sales tools. Guests see the standard market
   quote: seasonal markup, length-of-stay discount, end-month effect,
   lead-time decay toward next opening, vacancy-gap recovery, and the
   absolute floor/ceiling sanity clamps.
   ============================================================ */

/* ------------------------------------------------------------
   PRICING CONFIG — mirrored from the live Revenue Engine.
   Last synced: 2026-08-04

   IMPORTANT: these are the engine's *tuned* live values, which
   differ from the DEFAULTS hardcoded in the engine's source. If
   anyone changes the engine's Config tab, re-sync this block or
   website quotes will silently drift from staff quotes.
   To re-sync: open the engine, sign in, run `JSON.stringify(CFG)`
   in the browser console, and paste the values below.
   ------------------------------------------------------------ */
const PRICING_CFG = {
  seasonMarkup: {
    1: 0.35, 2: 0.35, 3: 0.45, 4: 0.80, 5: 0.89, 6: 1.05,
    7: 1.05, 8: 0.70, 9: 0.75, 10: 0.65, 11: 0.40, 12: 0.35
  },
  atDateFloorPeak: 0.35,
  atDateFloorDead: -0.05,
  winterHardFloorPct: -5,
  vacancyRecover: 70,
  decayHorizon: 75,
  decayAccelDays: 15,
  decayPhase1Exp: 0.41,
  decayPhase2Exp: 1.25,
  losDiscount: { 1: 0, 3: 6, 6: 15, 12: 18 },
  endMonthWeight: 0.7,
  spanWeight: 0.30,
  floorPct: 5,
  ceilingMult: 3,
  hostFee: 15.5
};

const PRICING_DAY = 86400000;
function pDaysBetween(a, b) { return Math.round((b - a) / PRICING_DAY); }
function pAddDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function pDaysInMonthOf(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function pTodayMid() { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }

function rentOwedBetween(baseRent, from, toExclusive) {
  if (!from || !toExclusive || toExclusive <= from) return 0;
  let total = 0;
  let cur = new Date(from);
  let guard = 0;
  while (cur < toExclusive && guard < 3000) {
    const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const segEnd = nextMonth < toExclusive ? nextMonth : toExclusive;
    const dim = pDaysInMonthOf(cur);
    total += baseRent * (pDaysBetween(cur, segEnd) / dim);
    cur = segEnd; guard++;
  }
  return total;
}

/* ---- Burn-day (vacancy gap) charging ---------------------------------
   The empty days between a home opening up and the guest moving in are
   billed progressively. Tunable here. */
const BURN_NEAR_DAYS = 14;   // length of the first tier, in days
const BURN_NEAR_RATE = 0.85; // tier 1: share of BASE RENT
const BURN_FAR_RATE  = 0.92; // tier 2: share of the SEASONAL rate for those dates

/* Straight span-blended seasonal rate for a window — no LOS discount, no
   decay, no gap recovery. Used to value the burn days beyond tier 1. */
function seasonalMonthlyFor(baseRent, from, to, CFG) {
  const fractions = spanMonthFractions(from, to);
  let markup = 0, any = false;
  for (const m in fractions) { markup += CFG.seasonMarkup[parseInt(m)] * fractions[m]; any = true; }
  if (!any) markup = CFG.seasonMarkup[from.getMonth() + 1];
  return baseRent * (1 + markup);
}

function blendedEndMarkup(lastNight, CFG) {
  const m = lastNight.getMonth() + 1;
  const nextM = m === 12 ? 1 : m + 1;
  const daysInMonth = new Date(lastNight.getFullYear(), lastNight.getMonth() + 1, 0).getDate();
  const dom = lastNight.getDate();
  const raw = (dom - 1) / Math.max(1, daysInMonth - 1);
  const blend = Math.min(0.85, Math.pow(raw, 0.75) * 0.95);
  return CFG.seasonMarkup[m] * (1 - blend) + CFG.seasonMarkup[nextM] * blend;
}

function spanMonthFractions(moveIn, moveOut) {
  const fractions = {};
  const total = pDaysBetween(moveIn, moveOut);
  if (total <= 0) return fractions;
  let cur = new Date(moveIn);
  while (cur < moveOut) {
    const m = cur.getMonth() + 1;
    const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const end = nextMonth < moveOut ? nextMonth : moveOut;
    fractions[m] = (fractions[m] || 0) + pDaysBetween(cur, end) / total;
    cur = end;
  }
  return fractions;
}

function losDiscountPct(months, CFG) {
  const m = Math.max(1, months);
  if (m >= 12) return CFG.losDiscount[12];
  if (m <= 1) return CFG.losDiscount[1];
  const anchors = [[1, CFG.losDiscount[1]], [3, CFG.losDiscount[3]], [6, CFG.losDiscount[6]], [12, CFG.losDiscount[12]]];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [m1, d1] = anchors[i], [m2, d2] = anchors[i + 1];
    if (m >= m1 && m <= m2) {
      const t = (Math.log(m) - Math.log(m1)) / (Math.log(m2) - Math.log(m1));
      return d1 + t * (d2 - d1);
    }
  }
  return CFG.losDiscount[12];
}

function atDateFloorMarkup(month, CFG) {
  const asks = Object.values(CFG.seasonMarkup);
  const minAsk = Math.min(...asks);
  const maxAsk = Math.max(...asks);
  const s = CFG.seasonMarkup[month];
  const pos = maxAsk > minAsk ? (s - minAsk) / (maxAsk - minAsk) : 0.5;
  return CFG.atDateFloorDead + pos * (CFG.atDateFloorPeak - CFG.atDateFloorDead);
}

function decayShape(daysUntilAvailable, CFG) {
  const H = CFG.decayHorizon;
  const A = CFG.decayAccelDays;
  if (daysUntilAvailable >= H) return 1;
  if (daysUntilAvailable <= 0) return 0;
  const gAtAccel = Math.pow(A / H, CFG.decayPhase1Exp);
  if (daysUntilAvailable >= A) return Math.pow(daysUntilAvailable / H, CFG.decayPhase1Exp);
  return gAtAccel * Math.pow(daysUntilAvailable / A, CFG.decayPhase2Exp);
}

function decayedMarkup(daysUntilAvailable, month, CFG) {
  const ask = CFG.seasonMarkup[month];
  const floor = atDateFloorMarkup(month, CFG);
  const g = decayShape(daysUntilAvailable, CFG);
  return floor + (ask - floor) * g;
}

/* Core stay pricing — mirrors the internal engine's priceStay() exactly
   (minus dynamicFloor / fillMode, which are staff-only concepts). */
function priceStay(baseRent, moveIn, moveOut, CFG, opts = {}) {
  const nights = pDaysBetween(moveIn, moveOut);
  const months = nights / 30.4375;
  const moveInMonth = moveIn.getMonth() + 1;
  const lastNight = new Date(moveOut.getTime() - PRICING_DAY);

  let markup = CFG.seasonMarkup[moveInMonth];

  const fractions = spanMonthFractions(moveIn, moveOut);
  let spanMarkup = 0;
  for (const [m, f] of Object.entries(fractions)) spanMarkup += CFG.seasonMarkup[parseInt(m)] * f;
  markup = markup * (1 - CFG.spanWeight) + spanMarkup * CFG.spanWeight;

  const endMarkup = blendedEndMarkup(lastNight, CFG);
  const moveInMarkup = CFG.seasonMarkup[moveInMonth];
  const endDev = endMarkup - moveInMarkup;
  const lengthScale = Math.min(1, months / 12);
  let endEffect;
  if (endDev < 0) endEffect = -endDev * CFG.endMonthWeight * lengthScale;
  else endEffect = -endDev * CFG.endMonthWeight * lengthScale * 0.4;
  markup += endEffect;

  const losPct = losDiscountPct(months, CFG);
  let perMonthMarkup = markup;
  perMonthMarkup = (1 + perMonthMarkup) * (1 - losPct / 100) - 1;

  let perMonth;
  if (opts.applyLeadTime && typeof opts.daysUntilAvailable === 'number') {
    /* The ask decays toward the at-date floor as the opening approaches.
       IMPORTANT: the ask is the span-blended seasonal markup — i.e. what the
       months the guest actually occupies are worth — not the move-in month
       alone. A Dec–Jun stay runs through peak spring/summer and must be
       priced accordingly; using only December's dead-season markup badly
       under-prices long stays. For a single-month stay the span equals the
       move-in month, so short-stay pricing is unchanged. */
    const ask = Math.max(spanMarkup, CFG.seasonMarkup[moveInMonth]);
    const floor = atDateFloorMarkup(moveInMonth, CFG);
    const decMarkup = floor + (ask - floor) * decayShape(opts.daysUntilAvailable, CFG);
    const decReduced = (1 + decMarkup) * (1 - losPct / 100) - 1;
    perMonth = baseRent * (1 + decReduced);
  } else {
    perMonth = baseRent * (1 + perMonthMarkup);
  }

  /* Burn days — the empty nights between the home opening up and the guest
     moving in. Charged progressively, then spread across the stay:
       · first 2 weeks of the gap  → 85% of base rent
       · every day beyond that     → 92% of the seasonal rate for those dates */
  let vacancyAdd = 0, vacancyPerMonth = 0, gapDays = 0;
  if (opts.availableDate && opts.moveInForGap) {
    gapDays = pDaysBetween(opts.availableDate, opts.moveInForGap);
    if (gapDays > 0) {
      const availDate = opts.availableDate;
      const moveIn = opts.moveInForGap;
      const tierBoundary = gapDays <= BURN_NEAR_DAYS ? moveIn : pAddDays(availDate, BURN_NEAR_DAYS);

      // Tier 1 — first two weeks at 85% of base rent
      vacancyAdd = rentOwedBetween(baseRent * BURN_NEAR_RATE, availDate, tierBoundary);

      // Tier 2 — the remainder at 92% of the seasonal rate for those dates
      if (moveIn > tierBoundary) {
        const seasonalMonthly = seasonalMonthlyFor(baseRent, tierBoundary, moveIn, CFG);
        vacancyAdd += rentOwedBetween(seasonalMonthly * BURN_FAR_RATE, tierBoundary, moveIn);
      }

      vacancyPerMonth = months > 0 ? vacancyAdd / months : 0;
      perMonth += vacancyPerMonth;
    }
  }

  const absFloor = baseRent * (1 + CFG.floorPct / 100);
  if (perMonth < absFloor) perMonth = absFloor;

  const ceiling = baseRent * CFG.ceilingMult;
  if (perMonth > ceiling) perMonth = ceiling;

  return {
    nights, months,
    perMonth,
    offNightly: perMonth / 30.4375,
    totalOff: perMonth * months,
    vacancyPerMonth, gapDays
  };
}

/* ===== Public entry point =====
   unit: { baseRent }
   moveInDate/moveOutDate: JS Date objects (midnight local)
   availableDate: JS Date the unit is next free (from iCal), or null
   Returns guest-safe fields only — no markup %, no internal flags. */
/* Twelve-month stays price on the normal rules, but never below a 20%
   markup over base — the length-of-stay discount can otherwise cut an
   annual term further than we're willing to go. */
const LONG_STAY_MONTHS = 11.5;
const LONG_STAY_MIN_MARKUP = 0.20;

function getPublicQuote(unit, moveInDate, moveOutDate, availableDate) {
  const nights = pDaysBetween(moveInDate, moveOutDate);
  if (nights < 28) {
    return { ok: false, reason: 'min-stay', minNights: 28 };
  }
  const months = nights / 30.4375;
  const daysUntil = availableDate ? Math.max(0, pDaysBetween(pTodayMid(), availableDate)) : null;

  let perMonth = priceStay(unit.baseRent, moveInDate, moveOutDate, PRICING_CFG, {
    applyLeadTime: true,
    daysUntilAvailable: daysUntil,
    availableDate: availableDate,
    moveInForGap: moveInDate
  }).perMonth;

  if (months >= LONG_STAY_MONTHS) {
    perMonth = Math.max(perMonth, unit.baseRent * (1 + LONG_STAY_MIN_MARKUP));
  }

  return {
    ok: true,
    nights: nights,
    months: Math.round(months * 100) / 100,
    monthlyRate: Math.round(perMonth),
    nightlyRate: Math.round((perMonth / 30.4375) * 100) / 100,
    total: Math.round(perMonth * months),
    // Utilities are billed separately on stays of 6 months or longer.
    utilitiesSeparate: months >= 5.95
  };
}

if (typeof window !== 'undefined') {
  window.BroadlinePricing = { getPublicQuote };
}
