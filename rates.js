/* ============================================================
   BROADLINE LIVING — PUBLISHED RATES
   ============================================================
   Reads the final guest-facing nightly rates that the Revenue
   Engine publishes to Supabase. This REPLACES pricing.js.

   WHY THIS EXISTS
   pricing.js computed prices in the browser, which meant shipping
   the entire pricing model to every visitor: base rent per unit,
   the seasonal markup curve, floors, decay parameters, LOS
   discounts and the host fee. Anyone could derive exactly what
   Broadline pays in rent and what margin it makes on each home.

   This file ships none of that. It reads only the final nightly
   number per date range — the same table the Rentals United push
   reads — so the website and RU can never quietly disagree, and
   there is nothing here worth reverse-engineering.

   NEVER reintroduce base rent, markup, floors or config values to
   this file or to units-config.js.

   NO PUBLISHED RATE = NO QUOTE
   If a date in the requested range has no published rate, this
   returns ok:false. The caller must fall back to "Inquire" rather
   than inventing a number. A wrong public price is worse than no
   price. Units are only quotable once the engine has published
   them, which is deliberate.
   ============================================================ */

(function () {
  'use strict';

  var SUPABASE_URL = 'https://gtjlnuoqwnjxramexnmn.supabase.co';
  // Public anon key. published_rates is world-readable by design and holds
  // only final rates — see published_rates.sql for why that is safe.
  var SUPABASE_ANON = 'sb_publishable_1kRz8k_lW6lRUISa5DxZjg_86XXawLE';

  var DAY = 86400000;

  /* Date-only strings must be parsed as LOCAL midnight. `new Date("2026-08-10")`
     parses as UTC midnight, which is the previous day in New York and shifts
     every rate block by one day. This bug has bitten this codebase before. */
  function parseDate(iso) {
    if (!iso) return null;
    var p = String(iso).slice(0, 10).split('-');
    if (p.length !== 3) return null;
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function toISO(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function nightsBetween(a, b) { return Math.round((b - a) / DAY); }

  /* ---- NYC Hotel Room Occupancy Tax --------------------------------------
     CPA-confirmed (Aug 2026): NYS/NYC *sales* tax does NOT apply to this
     furnished-apartment model (20 NYCRR 527.9 — a furnished living unit is
     outside the "hotel" definition when no housekeeping/food/hotel services
     are provided). Only the occupancy tax applies:

         5.875% of rent  +  $2.00 per room per night

     Exempt entirely at 180+ consecutive nights. Rooms = bedrooms + 1, since
     the living room counts; a studio is 1 room. */
  var OCCUPANCY_PCT = 0.05875;
  var PER_ROOM_NIGHT = 2.00;
  var TAX_EXEMPT_NIGHTS = 180;

  function taxFor(rentTotal, nights, rooms) {
    if (nights >= TAX_EXEMPT_NIGHTS) {
      return { pct: 0, perRoom: 0, total: 0, exempt: true };
    }
    var pct = rentTotal * OCCUPANCY_PCT;
    var perRoom = PER_ROOM_NIGHT * (rooms || 1) * nights;
    return { pct: pct, perRoom: perRoom, total: pct + perRoom, exempt: false };
  }

  /* ---- fetching ----------------------------------------------------------
     Keyed on ru_property_id because that is what units-config.js already
     carries per unit. Returns [] for "no rates published", null for "the
     lookup failed" — the caller must not treat those the same. */
  var _cache = {};

  function fetchRates(ruPropertyId) {
    if (!ruPropertyId) return Promise.resolve([]);
    if (_cache[ruPropertyId]) return Promise.resolve(_cache[ruPropertyId]);

    var url = SUPABASE_URL + '/rest/v1/published_rates' +
      '?select=date_from,date_to,nightly,min_nights' +
      '&ru_property_id=eq.' + encodeURIComponent(ruPropertyId) +
      '&order=date_from';

    return fetch(url, {
      headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON }
    }).then(function (r) {
      if (!r.ok) throw new Error('rates ' + r.status);
      return r.json();
    }).then(function (rows) {
      var parsed = (rows || []).map(function (x) {
        return {
          from: parseDate(x.date_from),
          to: parseDate(x.date_to),          // inclusive last night
          nightly: parseFloat(x.nightly),
          minNights: parseInt(x.min_nights, 10) || 30
        };
      }).filter(function (x) { return x.from && x.to && isFinite(x.nightly); });
      _cache[ruPropertyId] = parsed;
      return parsed;
    }).catch(function (e) {
      console.error('Published rates unavailable for', ruPropertyId, e);
      return null;
    });
  }

  function rateOn(rates, date) {
    for (var i = 0; i < rates.length; i++) {
      if (date >= rates[i].from && date <= rates[i].to) return rates[i];
    }
    return null;
  }

  /* Earliest and latest dates we have any published rate for. Used to bound
     the calendar so guests can't pick into a stretch we can't price. */
  function coverage(rates) {
    if (!rates || !rates.length) return null;
    var from = rates[0].from, to = rates[0].to;
    for (var i = 1; i < rates.length; i++) {
      if (rates[i].from < from) from = rates[i].from;
      if (rates[i].to > to) to = rates[i].to;
    }
    return { from: from, to: to };
  }

  /* ---- quoting -----------------------------------------------------------
     Sums the published nightly rate for every night of the stay. Nightly is
     the source of truth; the monthly figure shown to a guest is 30 nights of
     it (NOT 30.4375 — that constant measures elapsed time, never converts a
     rate, and mixing the two made the old site's monthly disagree with its
     own stay total by ~1.5%). */
  var RATE_NIGHTS_PER_MONTH = 30;

  /* ---- Refundable security deposit ---------------------------------------
     $1,000 for every month booked, never more than one month's rent. So a
     three-month stay holds $3,000; anything from roughly five months up is
     capped at the monthly rate.

     Months are ROUNDED to the nearest whole month rather than taken as a
     fraction: a deposit is a round figure, and billing $1,167 because a stay
     ran 35 nights instead of 30 would be strange. A 35-night stay therefore
     holds $1,000, and 46 nights (1.53 months) holds $2,000.

     This is refundable, so it is deliberately NOT part of the quoted total --
     it is held, not spent. The UI must present it separately or it reads as a
     price rise. */
  var DEPOSIT_PER_MONTH = 1000;

  function depositFor(nights, monthlyRate) {
    var wholeMonths = Math.max(1, Math.round(nights / RATE_NIGHTS_PER_MONTH));
    return Math.min(DEPOSIT_PER_MONTH * wholeMonths, Math.round(monthlyRate));
  }

  /* ---- Vacancy gap ("burn days") -----------------------------------------
     Nights between a home opening up and the guest actually moving in earn
     nothing. Previously nothing recovered them: the engine publishes block
     rates and never passes a move-in date, so published_rates carries no gap
     charge at all, and the website's old copy of that math went with
     pricing.js. This restores it on the published-rate side.

     GAP_LIMIT_DAYS also bounds what we will quote at all. Past it the empty
     stretch is long enough that the rate is a conversation, not a formula —
     the UI shows an inquiry prompt instead of a number. It matches the
     instant-apply window on purpose, so "can I get a price" and "can I apply"
     are the same question rather than two different cutoffs.

     BURN_RECOVERY_PCT is the dial. The old model charged 85% of BASE RENT per
     burn night — i.e. recover the landlord cost, not the margin. Base rent is
     deliberately not available in the browser any more, so this is expressed
     against the published nightly instead. Across the markup range actually
     in use (~20-110%), 85% of base lands near 0.45-0.57 of the published
     nightly, so 0.5 approximates the old behaviour. Tune this one number if
     you want gaps to hurt more or less. */
  var GAP_LIMIT_DAYS = 5;
  var BURN_RECOVERY_PCT = 0.5;

  /* ---- Payment options ----------------------------------------------------
     Pay the whole stay at signing, or pay monthly for 5% more on the rate.
     The uplift applies to RENT, and tax is then recalculated on that higher
     rent — tax is a percentage of what's actually charged, so applying the
     uplift after tax would quietly under-collect it.

     The first installment is due at signing alongside the deposit, so the
     guest hands over one month plus the deposit rather than the full term. */
  var INSTALLMENT_UPLIFT = 0.05;

  function burnCostFor(rates, availableDate, moveIn) {
    if (!availableDate || moveIn <= availableDate) return { days: 0, cost: 0 };
    var days = nightsBetween(availableDate, moveIn);
    var cost = 0;
    for (var d = new Date(availableDate); d < moveIn; d = addDays(d, 1)) {
      var r = rateOn(rates, d);
      // No published rate for a burn night: skip it rather than guess. Under-
      // charging is better than inventing a number for a date we can't price.
      if (r) cost += r.nightly * BURN_RECOVERY_PCT;
    }
    return { days: days, cost: cost };
  }

  /* opts.availableDate — the date the home actually frees up. Supplying it
     enables the vacancy-gap charge and the too-large-gap cutoff. Omitting it
     quotes with no gap logic at all, which is right for hypothetical ranges
     (e.g. costing a recommendation that starts on the open date). */
  function quote(rates, moveIn, moveOut, rooms, opts) {
    opts = opts || {};
    if (!rates) return { ok: false, reason: 'unavailable' };
    if (!rates.length) return { ok: false, reason: 'not-published' };

    var nights = nightsBetween(moveIn, moveOut);
    if (nights < 1) return { ok: false, reason: 'bad-range' };

    var minNights = rates[0].minNights || 30;
    if (nights < minNights) return { ok: false, reason: 'min-stay', minNights: minNights };

    /* Too long a gap between the home opening and the move-in: refuse to
       quote. Checked before pricing anything so no number is ever computed
       for a range we won't stand behind. */
    var avail = opts.availableDate || null;
    if (avail && nightsBetween(avail, moveIn) > GAP_LIMIT_DAYS) {
      return {
        ok: false, reason: 'gap-too-large',
        gapDays: nightsBetween(avail, moveIn),
        limitDays: GAP_LIMIT_DAYS,
        availableDate: avail
      };
    }

    var rentTotal = 0;
    for (var d = new Date(moveIn); d < moveOut; d = addDays(d, 1)) {
      var r = rateOn(rates, d);
      // A single unpriced night invalidates the whole quote. Do not
      // interpolate or carry a neighbouring rate across the gap.
      if (!r) return { ok: false, reason: 'no-rate-for-date', missing: toISO(d) };
      rentTotal += r.nightly;
    }

    /* Vacancy gap. Treated as rent — it is money paid to hold the home — so
       it sits inside the taxable base and lifts the effective nightly, which
       is what makes "move in when it opens" genuinely cheaper. */
    var burn = burnCostFor(rates, avail, moveIn);
    var rentPlusBurn = rentTotal + burn.cost;

    var avgNightly = rentPlusBurn / nights;
    var tax = taxFor(rentPlusBurn, nights, rooms);
    var monthlyRate = Math.round(avgNightly * RATE_NIGHTS_PER_MONTH);
    var deposit = depositFor(nights, monthlyRate);
    var total = Math.round(rentPlusBurn + tax.total);
    var months = nights / RATE_NIGHTS_PER_MONTH;

    return {
      ok: true,
      nights: nights,
      months: Math.round(months * 100) / 100,
      nightlyRate: Math.round(avgNightly * 100) / 100,
      monthlyRate: monthlyRate,
      /* Rent AND tax, per month. This is the number to compare stays on:
         comparing rent-only monthlies hides the 180-night tax exemption, so a
         longer stay that is cheaper purely because tax drops off would look
         like no saving at all. */
      monthlyAllIn: Math.round((rentPlusBurn + tax.total) / months),
      rentTotal: Math.round(rentTotal),
      burnDays: burn.days,
      burnCost: Math.round(burn.cost),
      tax: {
        occupancyPct: Math.round(tax.pct),
        perRoomNight: Math.round(tax.perRoom),
        total: Math.round(tax.total),
        exempt: tax.exempt
      },
      total: total,
      /* Refundable — held, not charged. Kept out of `total` on purpose; the
         caller shows it as a separate line and as part of "due at signing". */
      deposit: deposit,
      dueAtSigning: total + deposit,

      /* Two ways to pay the same stay. `payFull` is the figures above; the
         installment plan re-prices rent with the uplift and recomputes tax on
         top of it. Both carry the same refundable deposit. */
      payFull: {
        total: total,
        atSigning: total + deposit,
        monthlyRate: monthlyRate
      },
      payMonthly: (function () {
        var upRent = rentPlusBurn * (1 + INSTALLMENT_UPLIFT);
        var upTax = taxFor(upRent, nights, rooms);
        var upTotal = Math.round(upRent + upTax.total);
        // Whole months, minimum one, so a 35-night stay is a single payment
        // rather than 1.17 awkward ones.
        var installments = Math.max(1, Math.round(months));
        var per = Math.round(upTotal / installments);
        return {
          /* A single-installment "plan" is not a plan — it's the whole stay
             with a 5% surcharge bolted on, and it would price ABOVE paying
             upfront. Offer the choice only when there is something to spread. */
          available: installments >= 2,
          upliftPct: INSTALLMENT_UPLIFT * 100,
          monthlyRate: Math.round((upRent / nights) * RATE_NIGHTS_PER_MONTH),
          perInstallment: per,
          installments: installments,
          total: upTotal,
          // First installment plus the deposit, handed over at signing.
          atSigning: per + deposit,
          premium: upTotal - total,
          taxTotal: Math.round(upTax.total),
          exempt: upTax.exempt
        };
      })(),
      // Utilities are billed separately on stays of ~6 months or longer.
      utilitiesSeparate: months >= 5.95
    };
  }

  if (typeof window !== 'undefined') {
    window.BroadlineRates = {
      fetchRates: fetchRates,
      quote: quote,
      coverage: coverage,
      rateOn: rateOn,
      parseDate: parseDate,
      toISO: toISO,
      TAX_EXEMPT_NIGHTS: TAX_EXEMPT_NIGHTS,
      GAP_LIMIT_DAYS: GAP_LIMIT_DAYS
    };
  }
})();
