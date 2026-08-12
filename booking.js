/* ============================================================
   BROADLINE LIVING — BOOKING WIDGET
   Live Rentals United availability + published rates from the
   Revenue Engine + stay recommendations + application handoff.

   Pricing is NOT computed here. It is read from Supabase
   `published_rates` via rates.js — the same rates pushed to
   Rentals United, so the two can never disagree. The old
   pricing.js (which shipped base rents and the whole markup
   model to the browser) has been removed; don't bring it back.

   Requires: units-config.js, rates.js, availability.js, booking.css
   ============================================================ */

(function () {
  'use strict';

  var MIN_NIGHTS = 30;
  /* How far past a home's next-open date we'll still let someone apply
     instantly. Beyond this the dates get confirmed by a human first — holding
     a home open for weeks on a self-serve application is how you end up with
     an empty apartment and no deposit. */
  var BOOK_WINDOW_DAYS = 5;
  var FORMSPREE = 'https://formspree.io/f/mjgzzger';
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DOW = ['S','M','T','W','T','F','S'];
  /* Months where the home re-lets fastest — we steer guests toward move-out
     dates at the end of May, June or July. */
  var PEAK_END_MONTHS = [5, 6, 7];

  function todayMid() { var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
  function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function addMonths(d, n) { var r = new Date(d); r.setMonth(r.getMonth() + n); return r; }
  function nightsBetween(a, b) { return Math.round((b - a) / 86400000); }
  function sameDay(a, b) { return a && b && a.getTime() === b.getTime(); }
  function fmtShort(d) { return MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  function fmtMoney(n) { return '$' + Math.round(n).toLocaleString(); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); }
  /* A month here is 30 NIGHTS, matching how the rate is quoted — not 30.4375,
     which measures elapsed time. Using the calendar figure made 30 nights read
     as "30 nights" while 31 read as "1 month", and silently swallowed up to
     two extra nights. That is what made the rent line look inflated against
     the monthly headline: 31 nights of rent under a label claiming one month.
     Every extra night is now named. */
  function durationLabel(nights) {
    var whole = Math.floor(nights / 30);
    var extra = nights - whole * 30;
    if (whole === 0) return nights + ' night' + (nights === 1 ? '' : 's');
    var base = whole + ' month' + (whole > 1 ? 's' : '');
    if (!extra) return base;
    return base + ' & ' + extra + ' night' + (extra === 1 ? '' : 's');
  }

  function BookingWidget(mountEl, unitKey) {
    this.el = mountEl;
    this.unitKey = unitKey;
    this.unit = window.BROADLINE_UNITS[unitKey];
    this.busy = null;
    this.loadFailed = false;
    this.moveIn = null;
    this.moveOut = null;
    this.picking = 'in';
    this.earliest = null;
    this.viewMonth = null;
    this.submitted = false;
    /* Final nightly rates published by the Revenue Engine.
         null = still loading or the lookup failed
         []   = loaded, but this unit has nothing published yet
       Both mean "cannot quote", but only the second is a normal state. */
    this.rates = null;
    this.ratesLoaded = false;
    /* Dates the guest had chosen before applying a recommendation, so the
       suggestion is reversible. Without this the only way back was a page
       reload, which loses everything. */
    this.prevSelection = null;
    /* One-shot message explaining why a calendar click did nothing. The old
       code just `return`ed on an invalid pick, so the widget looked frozen. */
    this.dayHint = null;
    /* Which payment plan the guest picked. Carried through to the application
       and the inquiry email so the choice isn't lost at handoff. */
    this.payPlan = 'full';   // 'full' | 'monthly'
  }

  BookingWidget.prototype.init = function () {
    var self = this;
    if (!this.unit) { this.el.innerHTML = '<div class="bk-card"><p class="bk-sub">Unit not configured.</p></div>'; return; }
    var t = todayMid();
    this.viewMonth = new Date(t.getFullYear(), t.getMonth(), 1);
    this.render();
    /* Two independent lookups: RU's iCal for what's booked, Supabase for what
       it costs. Both must land before a quote is possible, so wait on both
       rather than rendering a price against half-loaded state. */
    Promise.all([
      window.BroadlineAvailability.fetchBusyRanges(this.unit.ruPropertyId),
      window.BroadlineRates.fetchRates(this.unit.ruPropertyId)
    ]).then(function (res) {
      var ranges = res[0], rates = res[1];
      if (ranges === null) { self.loadFailed = true; self.busy = []; }
      else { self.busy = ranges; }
      self.rates = rates;          // null on failure, [] when nothing published
      self.ratesLoaded = true;
      self.earliest = window.BroadlineAvailability.earliestAvailable(self.busy, MIN_NIGHTS);
      if (self.earliest && self.earliest > todayMid()) {
        self.viewMonth = new Date(self.earliest.getFullYear(), self.earliest.getMonth(), 1);
      }
      self.render();
    });
  };

  /* ---------- availability ---------- */
  BookingWidget.prototype.isBusy = function (d) {
    if (!this.busy || !this.busy.length) return false;
    return window.BroadlineAvailability.isDateBusy(d, this.busy);
  };
  BookingWidget.prototype.rangeIsFree = function (from, to) {
    for (var d = new Date(from); d < to; d = addDays(d, 1)) if (this.isBusy(d)) return false;
    return true;
  };
  BookingWidget.prototype.canBeMoveOut = function (d) {
    if (!this.moveIn || d <= this.moveIn) return false;
    if (nightsBetween(this.moveIn, d) < MIN_NIGHTS) return false;
    return this.rangeIsFree(this.moveIn, d);
  };

  BookingWidget.prototype.onDayClick = function (d) {
    this.dayHint = null;
    if (this.picking === 'out' && this.moveIn) {
      if (this.canBeMoveOut(d)) { this.moveOut = d; this.picking = 'in'; }
      else if (d <= this.moveIn) { this.moveIn = d; this.moveOut = null; }
      else if (nightsBetween(this.moveIn, d) < MIN_NIGHTS) {
        // Say why. Silently ignoring the click reads as a broken calendar.
        this.dayHint = 'Minimum stay is ' + MIN_NIGHTS + ' nights — pick a move-out on or after ' +
                       fmtShort(addDays(this.moveIn, MIN_NIGHTS)) + '.';
      } else {
        this.dayHint = 'Those dates run into a booked period. Try an earlier move-out.';
      }
    } else {
      if (d < todayMid()) { this.dayHint = 'That date has already passed.'; }
      else if (this.isBusy(d)) { this.dayHint = 'That date is already booked.'; }
      else { this.moveIn = d; this.moveOut = null; this.picking = 'out'; }
    }
    this.render();
  };

  /* Wipe the selection back to nothing. */
  BookingWidget.prototype.clearDates = function () {
    this.moveIn = null; this.moveOut = null; this.picking = 'in';
    this.prevSelection = null; this.dayHint = null;
    // Starting over means starting over — a stale monthly selection would
    // otherwise silently apply the 5% uplift to whatever they pick next.
    this.payPlan = 'full';
    this.render();
  };

  /* Undo a recommendation and go back to whatever the guest had picked. */
  BookingWidget.prototype.restorePrevious = function () {
    if (!this.prevSelection) return;
    this.moveIn = this.prevSelection.moveIn;
    this.moveOut = this.prevSelection.moveOut;
    this.prevSelection = null;
    this.dayHint = null;
    this.picking = 'in';
    this.viewMonth = new Date(this.moveIn.getFullYear(), this.moveIn.getMonth(), 1);
    this.render();
  };

  /* Quotes come from the rates the Revenue Engine published — no pricing model
     runs in the browser any more. If a night in the range isn't published,
     this returns ok:false and the UI must offer "Inquire", never a guess. */
  BookingWidget.prototype.quoteFor = function (moveIn, moveOut) {
    if (!this.ratesLoaded) return { ok: false, reason: 'loading' };
    /* availableDate drives both the vacancy-gap charge and the refusal to
       quote too far past the opening. */
    return window.BroadlineRates.quote(this.rates, moveIn, moveOut, this.unit.rooms,
      { availableDate: this.earliest || null });
  };
  BookingWidget.prototype.quote = function () {
    if (!this.moveIn || !this.moveOut) return null;
    return this.quoteFor(this.moveIn, this.moveOut);
  };

  /* True when the chosen move-in is close enough to the home's next-open date
     to allow a self-serve application. If availability never loaded we don't
     know the open date, so we fail closed to "inquire" rather than opening the
     apply flow on an assumption. */
  BookingWidget.prototype.withinBookingWindow = function () {
    if (!this.moveIn || !this.earliest) return false;
    var slack = nightsBetween(this.earliest, this.moveIn);
    return slack <= BOOK_WINDOW_DAYS;   // negative = before it frees up; the calendar already blocks that
  };

  /* ---------- stay recommendations ----------
     Suggests alternatives that end in peak season (when the home re-lets best)
     or start the day it frees up. Only ranges that are actually free on the
     live calendar, and only ones that cost LESS per month than the guest's
     current selection — never an upsell. When nothing is cheaper, nothing is
     shown, which is the correct outcome rather than a gap to fill. */
  BookingWidget.prototype.recommendations = function () {
    if (!this.moveIn || !this.moveOut) return [];
    var current = this.quote();
    var self = this;

    /* Dates too far past the opening to price. Rather than leaving the guest
       at a dead end with only "inquire", offer the one alternative that is
       guaranteed to work: the same length stay starting when the home
       actually opens. There's no quotable "current" to compare against, so it
       carries no savings flair — just a real, bookable price. */
    if (current && !current.ok && current.reason === 'gap-too-large' && this.earliest) {
      var n = nightsBetween(this.moveIn, this.moveOut);
      var alt = this.quoteFor(this.earliest, addDays(this.earliest, n));
      if (alt.ok && this.rangeIsFree(this.earliest, addDays(this.earliest, n))) {
        return [{
          moveIn: this.earliest, moveOut: addDays(this.earliest, n),
          nights: n, quote: alt, flavor: 'nogap',
          allInSave: 0, rentSave: 0, taxSave: 0, noCompare: true
        }];
      }
      return [];
    }

    if (!current || !current.ok) return [];
    var out = [];
    var curNights = nightsBetween(this.moveIn, this.moveOut);

    function consider(moveIn, moveOut, flavor) {
      if (!moveIn || !moveOut) return;
      if (moveIn < todayMid()) return;
      var n = nightsBetween(moveIn, moveOut);
      if (n < MIN_NIGHTS) return;
      if (sameDay(moveIn, self.moveIn) && sameDay(moveOut, self.moveOut)) return;
      if (!self.rangeIsFree(moveIn, moveOut)) return;
      var q = self.quoteFor(moveIn, moveOut);
      if (!q.ok) return;
      /* QUALIFY on the all-in cost (rent + tax), DISPLAY the two separately.
         Judging on rent alone hid the biggest saving available: at 180+ nights
         occupancy tax falls away completely, so a longer stay can be far
         cheaper to actually pay while its rent line looks unchanged. Those
         options now surface. But the card still shows the rent-only monthly,
         so the headline rate matches every other rate on the site, with the
         tax saving called out as its own figure. */
      var allInSave = current.monthlyAllIn - q.monthlyAllIn;
      /* Never recommend an alternative that costs MORE overall than what the
         guest already chose — that's an upsell, not help. This also gates the
         earlier-start option to when it's useful: moving in sooner is cheaper
         precisely when a vacancy gap is being charged for. */
      if (allInSave <= 0) return;
      out.push({
        moveIn: moveIn, moveOut: moveOut, nights: n, quote: q, flavor: flavor,
        allInSave: allInSave,
        rentSave: current.monthlyRate - q.monthlyRate,   // $/mo, may be <= 0
        /* Per month, so it reads alongside the rent saving in the same unit.
           For an exempt stay this is the tax THAT stay avoids — not the
           difference against the guest's shorter selection, which made a
           six-month exemption look like one month's worth of tax. */
        taxSavePerMonth: q.tax.exempt
          ? q.tax.wouldHaveBeenPerMonth
          : (current.tax.perMonth - q.tax.perMonth),
        taxSaveTotal: q.tax.exempt
          ? q.tax.wouldHaveBeen
          : (current.tax.total - q.tax.total)
      });
    }

    /* 1. Same stay length, but starting the day the home is actually free.
       Booking after the opening makes the guest absorb the empty "burn days"
       through the vacancy charge — moving in sooner removes it. */
    if (this.earliest && this.earliest < this.moveIn) {
      consider(this.earliest, addDays(this.earliest, curNights), 'nogap');
    }

    /* 2. Fixed-duration alternatives from the same move-in.
       Previously the ONLY long options came from peak-end dates longer than
       the current stay, so a guest who already picked a long stay — or who
       landed on the longest suggestion — saw nothing at all. These durations
       are always tried, in both directions, so tweaking dates never empties
       the list.

       183 nights is deliberately in the set: that is where occupancy tax
       stops applying, which is usually the single biggest saving available
       and was previously reachable only by accident. */
    var DURATIONS = [90, 120, 183, 274, 365];
    DURATIONS.forEach(function (n) {
      if (Math.abs(n - curNights) < 5) return;          // materially different only
      consider(self.moveIn, addDays(self.moveIn, n), n > curNights ? 'long' : 'short');
    });

    /* 3. End dates landing in May/June/July, when the home re-lets best. */
    var cands = this.peakEndCandidates(this.moveIn).filter(function (d) {
      return !sameDay(d, self.moveOut) && self.rangeIsFree(self.moveIn, d);
    });
    if (cands.length) {
      consider(this.moveIn, cands[cands.length - 1], 'long');
      var target = 183;
      var mid = cands.reduce(function (best, d) {
        return Math.abs(nightsBetween(self.moveIn, d) - target) <
               Math.abs(nightsBetween(self.moveIn, best) - target) ? d : best;
      }, cands[0]);
      consider(this.moveIn, mid, 'mid');
    }

    /* Suggestions must be visibly different lengths. Keying on the duration
       label stopped working once the label got precise about extra nights:
       "9 months & 3 nights" and "9 months & 17 nights" are distinct strings
       but the same offer as far as a guest is concerned. Month buckets don't
       fix it either — 273 nights rounds to 9 and 287 to 10, so a two-week gap
       still slips through as two separate cards.

       So enforce real spacing: sort by saving, then accept a candidate only
       if it is at least a month away from every one already accepted. The
       best-value option in each part of the range survives.

       'nogap' is exempt — it's the same length started earlier, a different
       axis entirely, and it gets one slot. */
    var MIN_SPACING_NIGHTS = 30;
    out.sort(function (a, b) { return b.allInSave - a.allInSave; });
    var picked = [], usedNogap = false;
    out.forEach(function (r) {
      if (r.flavor === 'nogap') {
        if (usedNogap) return;
        usedNogap = true; picked.push(r); return;
      }
      var tooClose = picked.some(function (p) {
        return p.flavor !== 'nogap' && Math.abs(p.nights - r.nights) < MIN_SPACING_NIGHTS;
      });
      if (tooClose) return;
      picked.push(r);
    });
    /* Selected by value, but displayed shortest-to-longest. Leaving them in
       savings order put 6 months, 8 months, then 4 months side by side, which
       reads as unsorted. The earlier-start card stays first — it's a different
       axis (same length, sooner) and belongs at the front. */
    picked = picked.slice(0, 3).sort(function (a, b) {
      if (a.flavor === 'nogap') return -1;
      if (b.flavor === 'nogap') return 1;
      return a.nights - b.nights;
    });
    return picked;
  };

  /* Month-end dates falling in May, June or July, from move-in out to 12
     months — the windows where the home turns over most easily. */
  BookingWidget.prototype.peakEndCandidates = function (moveIn) {
    var out = [];
    var maxEnd = addMonths(moveIn, 12);
    for (var y = moveIn.getFullYear(); y <= moveIn.getFullYear() + 2; y++) {
      PEAK_END_MONTHS.forEach(function (m) {
        var d = new Date(y, m, 0); // last day of month m (1-indexed)
        if (d > moveIn && d <= maxEnd && nightsBetween(moveIn, d) >= MIN_NIGHTS) out.push(d);
      });
    }
    out.sort(function (a, b) { return a - b; });
    return out;
  };

  /* ---------- render ---------- */
  BookingWidget.prototype.render = function () {
    var self = this;
    var u = this.unit;

    if (this.submitted) {
      this.el.innerHTML =
        '<div class="bk-card"><div class="bk-eyebrow">Received</div>' +
        '<h3>Thanks — you\'re in the queue</h3>' +
        '<p class="bk-sub">We have your dates for ' + esc(u.name) + ' ' + esc(u.unitLabel) + '. ' +
        'You\'ll receive your application link by email shortly — credit check and documents are handled there.</p>' +
        '<div class="bk-msg info">Questions in the meantime? Email <a href="mailto:Info@broadlineliving.com" style="color:inherit;text-decoration:underline">Info@broadlineliving.com</a> or call <a href="tel:+19297372160" style="color:inherit;text-decoration:underline">(929) 737-2160</a>.</div></div>';
      return;
    }

    var loading = this.busy === null;
    var h = '<div class="bk-card">';
    h += '<div class="bk-eyebrow">Check availability</div>';
    h += '<h3>Reserve your dates</h3>';
    h += '<p class="bk-sub">Live availability and instant pricing. One month minimum.</p>';

    if (loading) {
      h += '<div class="bk-status"><span class="dot"></span><span>Checking live availability…</span></div>';
    } else if (this.loadFailed) {
      h += '<div class="bk-status err"><span class="dot"></span><span>Live calendar unavailable — contact us for dates.</span></div>';
    } else if (this.earliest) {
      var isNow = this.earliest <= todayMid();
      h += '<div class="bk-status ' + (isNow ? 'open' : 'soon') + '"><span class="dot"></span><span>' +
           (isNow ? '<strong>Available now</strong>' : 'Next available <strong>' + fmtShort(this.earliest) + '</strong>') + '</span></div>';
    } else {
      h += '<div class="bk-status soon"><span class="dot"></span><span>Fully booked — <strong>contact us for upcoming dates</strong></span></div>';
    }

    h += '<div class="bk-range">';
    h += '<button type="button" class="bk-slot' + (this.picking === 'in' ? ' active' : '') + '" data-pick="in">' +
         '<div class="lbl">Move-in' + (this.moveIn ? ' <span class="bk-slot-edit">change</span>' : '') + '</div>' +
         '<div class="val' + (this.moveIn ? '' : ' empty') + '">' +
         (this.moveIn ? fmtShort(this.moveIn) : 'Select date') + '</div></button>';
    h += '<button type="button" class="bk-slot' + (this.picking === 'out' ? ' active' : '') + '" data-pick="out">' +
         '<div class="lbl">Move-out' + (this.moveOut ? ' <span class="bk-slot-edit">change</span>' : '') + '</div>' +
         '<div class="val' + (this.moveOut ? '' : ' empty') + '">' +
         (this.moveOut ? fmtShort(this.moveOut) : 'Select date') + '</div></button>';
    h += '</div>';

    /* Escape hatches. Previously neither existed: applying a recommendation
       overwrote the guest's dates with no way back, and there was no way to
       start over short of reloading the page. */
    if (this.prevSelection || this.moveIn) {
      h += '<div class="bk-reset-row">';
      if (this.prevSelection) {
        h += '<button type="button" class="bk-linkbtn" data-act="restore">&#8249; Back to ' +
             fmtShort(this.prevSelection.moveIn) + ' &ndash; ' + fmtShort(this.prevSelection.moveOut) + '</button>';
      }
      if (this.moveIn) h += '<button type="button" class="bk-linkbtn" data-act="clear">Clear dates</button>';
      h += '</div>';
    }

    h += loading ? '<div class="bk-skel bk-skel-cal"></div>' : this.calendarHTML();

    if (this.dayHint) {
      h += '<div class="bk-msg warn">' + this.dayHint + '</div>';
    } else if (!loading && this.moveIn && !this.moveOut) {
      h += '<div class="bk-msg info">Now choose your move-out date — minimum stay is one month (' + MIN_NIGHTS + ' nights).</div>';
    }

    // stay recommendations
    var recs = this.recommendations();
    var q = this.quote();
    /* Nothing cheaper exists — say so instead of leaving a silent gap where
       the options row was. Reassurance, not an upsell. */
    if (q && !q.ok && recs.length) {
      // Gap-too-large fallback: show the bookable alternative above the notice.
      h += '<div class="bk-recs"><div class="bk-recs-t">Available instead</div><div class="bk-recs-scroll">';
      recs.forEach(function (r) {
        var iso = function (d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
        h += '<button type="button" class="bk-rec" data-rec-in="' + iso(r.moveIn) + '" data-rec-out="' + iso(r.moveOut) + '">' +
             '<div class="bk-rec-flag">Bookable</div>' +
             '<div class="bk-rec-lbl">Move in when it opens</div>' +
             '<div class="bk-rec-amt">' + fmtMoney(r.quote.monthlyRate) + '<span class="u">/mo</span></div>' +
             '<div class="bk-rec-dur">' + fmtShort(r.moveIn) + ' start</div></button>';
      });
      h += '</div></div>';
    }
    if (q && q.ok && !recs.length) {
      h += '<div class="bk-msg info">These dates are the best value we can offer for this home — ' +
           'no other length or start date comes out cheaper.</div>';
    }
    if (q && q.ok && recs.length) {
      h += '<div class="bk-recs"><div class="bk-recs-t">Stay recommendations</div><div class="bk-recs-scroll">';
      h += '<div class="bk-rec current"><div class="bk-rec-flag neutral">Your dates</div>' +
           '<div class="bk-rec-amt">' + fmtMoney(q.monthlyRate) + '<span class="u">/mo</span></div>' +
           '<div class="bk-rec-dur">' + durationLabel(q.nights) + '</div></div>';
      recs.forEach(function (r, i) {
        var LABELS = {
          nogap: 'Move in when it opens',
          long: 'Stay and save',
          mid: 'Stay and save',
          short: 'Shorter stay'
        };
        /* Two savings, shown separately. The rate stays rent-only so it lines
           up with every other rate on the site; the tax saving is its own
           figure. An option can qualify on tax alone — a 180+ night stay drops
           occupancy tax entirely — and that's exactly the case the old
           rent-only comparison made invisible. */
        /* The two savings are in different units and must say so. Rent is
           per month; tax is a whole-stay figure that comes off the total.
           Sitting side by side with only "/mo" on one of them, the tax number
           reads as monthly and overstates the saving several times over. */
        /* Both savings in $/month so they're directly comparable, with the
           whole-stay figure underneath since that's the number that lands. */
        /* Rent saving carries a number; tax does not. Quoting a tax figure
           here invited comparison with the tax line in the breakdown, which
           is a different basis. "No tax" is the whole message. */
        var bits = '';
        if (r.rentSave > 0) bits += '<div class="bk-rec-flag">Save ' + fmtMoney(r.rentSave) + '/mo</div>';
        if (r.quote.tax.exempt) bits += '<div class="bk-rec-flag tax">No tax</div>';
        if (!bits) bits = '<div class="bk-rec-flag">Save ' + fmtMoney(r.allInSave) + '/mo</div>';
        var iso = function (d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
        h += '<button type="button" class="bk-rec" data-rec-in="' + iso(r.moveIn) + '" data-rec-out="' + iso(r.moveOut) + '"' +
             ' style="animation-delay:' + (i * 45) + 'ms">' + bits +
             '<div class="bk-rec-lbl">' + LABELS[r.flavor] + '</div>' +
             '<div class="bk-rec-amt">' + fmtMoney(r.quote.monthlyRate) + '<span class="u">/mo</span></div>' +
             '<div class="bk-rec-dur">' + (r.flavor === 'nogap' ? fmtShort(r.moveIn) + ' start' : durationLabel(r.nights)) + '</div></button>';
      });
      h += '</div></div>';
    }

    // quote
    h += '<div class="bk-quote">';
    if (q && q.ok) {
      /* Every figure below follows the selected plan. Reading q.* directly
         meant picking "monthly" left the headline rate, rent and total all
         showing the upfront price — the +5% appeared only on the payment card,
         so it looked like the plan made no difference. */
      var v = (this.payPlan === 'monthly' && q.payMonthly.available) ? q.payMonthly : q.payFull;
      h += '<div class="bk-quote-main"><span class="bk-quote-amt">' + fmtMoney(v.monthlyRate) + '</span><span class="bk-quote-per">/ month</span></div>';
      h += '<div class="bk-quote-note">' + fmtMoney(v.nightlyRate) + ' per night · ' + q.nights + ' nights' +
           (v === q.payMonthly ? ' · incl. ' + q.payMonthly.upliftPct + '% installment rate' : '') + '</div>';
      /* Reads top to bottom as one arithmetic: what you pay each month,
         what that adds up to, the deposit held on top, and the single figure
         you actually hand over at signing. Nothing is repeated and every
         line either adds to the one below it or is clearly separated from it. */
      /* Four lines, one arithmetic: rent for the whole stay, tax on it, the
         deposit, and the sum. Tax is never amortised — it is charged once, in
         full, at signing, on both plans. */
      var payingMonthly = (v === q.payMonthly);
      h += '<div class="bk-lines">';
      h += '<div class="bk-line"><span>' + fmtShort(this.moveIn) + ' → ' + fmtShort(this.moveOut) + '</span><span>' + durationLabel(q.nights) + '</span></div>';
      h += '<div class="bk-line"><span>Total rent for stay</span><span>' + fmtMoney(v.rentForStay) + '</span></div>';
      if (v.exempt) {
        h += '<div class="bk-line"><span>NYC taxes</span><span>None</span></div>';
      } else {
        h += '<div class="bk-line"><span>NYC taxes</span><span>' + fmtMoney(v.taxTotal) + '</span></div>';
      }
      h += '<div class="bk-line dep"><span>Refundable deposit</span><span>' + fmtMoney(v.deposit) + '</span></div>';
      h += '<div class="bk-line grand"><span>Total due for stay</span><span>' +
           fmtMoney(v.total + v.deposit) + '</span></div>';
      if (payingMonthly) {
        /* Say plainly that the tax is not spread — it's the whole point of the
           split and the thing a guest would otherwise be surprised by. */
        h += '<div class="bk-line note"><span>' + fmtMoney(v.atSigning) + ' at signing &mdash; first rent payment of ' +
             fmtMoney(v.rentPerInstallment) + ', all ' + (v.exempt ? '' : fmtMoney(v.taxTotal) + ' ') +
             'taxes, and the deposit. Then ' + (v.installments - 1) + ' rent payment' +
             (v.installments - 1 === 1 ? '' : 's') + ' of ' + fmtMoney(v.rentPerInstallment) +
             '.</span><span></span></div>';
      } else {
        h += '<div class="bk-line note"><span>One payment at signing, including the ' +
             fmtMoney(v.deposit) + ' refundable deposit.</span><span></span></div>';
      }
      h += '</div>';

      /* Two ways to pay. Presented side by side rather than as a toggle so
         the trade-off is visible without interacting: pay once and pay less,
         or spread it and pay a premium. */
      var pm = q.payMonthly;
      /* Below two months there is nothing to spread, so the plan is hidden
         rather than shown as a worse version of paying once. */
      if (!pm.available && this.payPlan === 'monthly') this.payPlan = 'full';
      h += '<div class="bk-pay"><div class="bk-pay-t">' +
           (pm.available ? 'How you\'d like to pay' : 'Due at signing') + '</div>';
      h += '<div class="bk-pay-opts' + (pm.available ? '' : ' single') + '">';
      /* Both cards show the SAME measure — total cost of the stay, deposit
         excluded — so they can actually be compared. Previously this card
         showed total+deposit while the other showed a per-payment figure, so
         the cheaper option displayed as the larger number. The deposit is
         identical either way and already has its own line above. */
      /* These cards sit under "due at signing", so they show what is actually
         handed over — deposit INCLUDED. Showing the stay total here left the
         deposit out of the one number a guest checks before committing. */
      h += '<button type="button" class="bk-pay-opt' + (this.payPlan === 'full' ? ' sel' : '') + '" data-pay="full">' +
           '<div class="bk-pay-h">Pay upfront</div>' +
           '<div class="bk-pay-amt">' + fmtMoney(q.payFull.atSigning) + '</div>' +
           '<div class="bk-pay-sub">everything at signing &middot; incl. deposit</div>' +
           '<div class="bk-pay-tag best">Best price</div></button>';
      if (pm.available) {
        /* "per payment", never "/mo". A 183-night stay is 6.1 months billed
           in 6 installments, so an installment is larger than a month's rate
           — labelling both "/mo" put two different numbers in the same unit. */
        h += '<button type="button" class="bk-pay-opt' + (this.payPlan === 'monthly' ? ' sel' : '') + '" data-pay="monthly">' +
             '<div class="bk-pay-h">Monthly installments</div>' +
             '<div class="bk-pay-amt">' + fmtMoney(pm.atSigning) + '</div>' +
             '<div class="bk-pay-sub">at signing &middot; then ' + (pm.installments - 1) + ' &times; ' +
             fmtMoney(pm.rentPerInstallment) + '</div>' +
             '<div class="bk-pay-tag">+' + fmtMoney(pm.premium) + ' overall</div></button>';
      }
      h += '</div>';
      // The breakdown above already states the signing split; don't repeat it.
      h += '</div>';
      h += '<div class="bk-fine">Fully furnished. No booking fees. ' +
           'The ' + fmtMoney(q.deposit) + ' security deposit is refundable and returned after move-out, less any damages. ' +
           (q.tax.exempt ? 'Stays of 180 nights or more are exempt from occupancy tax. ' : '') +
           (q.utilitiesSeparate
             ? '<b>On stays of 6 months or longer, utilities are billed separately.</b>'
             : 'Utilities and Wi-Fi are included.') +
           '</div>';
    } else if (q && q.reason === 'loading') {
      h += '<div class="bk-quote-empty">Loading rates…</div>';
    } else if (q && q.reason === 'unavailable') {
      h += '<div class="bk-quote-empty">Pricing is temporarily unavailable — please get in touch and we\'ll quote you directly.</div>';
    } else if (q && (q.reason === 'not-published' || q.reason === 'no-rate-for-date')) {
      h += '<div class="bk-quote-empty">We don\'t have published pricing for those dates yet — send us an inquiry and we\'ll come back with a rate.</div>';
    } else if (q && q.reason === 'gap-too-large') {
      /* Name the way out, not just the problem. The guest can either move
         their start date into the priced window or ask us — say both, and
         give the actual latest date that works so it isn't arithmetic. */
      var lastPriced = addDays(q.availableDate, q.limitDays);
      h += '<div class="bk-quote-empty"><strong>Large gap &mdash; inquire for rates.</strong><br>' +
           'This home opens ' + fmtShort(q.availableDate) + ', ' + q.gapDays + ' days before your move-in. ' +
           'Pick a move-in up to ' + fmtShort(lastPriced) + ' to see a price, or inquire below.</div>';
    } else if (q && q.reason === 'min-stay') {
      h += '<div class="bk-quote-empty">Minimum stay is ' + q.minNights + ' nights.</div>';
    } else {
      h += '<div class="bk-quote-empty">Select your dates to see pricing.</div>';
    }
    h += '</div>';

    /* Book vs. inquire.
       Instant booking is only offered when the move-in is within a few days of
       the date the home actually frees up. Further out, the rate is still a
       real quote but the dates need a human — and this cannot be enforced on
       Rentals United (no such setting), so RU stays request-to-book. */
    var ready = !!(q && q.ok);
    var inWindow = ready && this.withinBookingWindow();
    if (ready && inWindow) {
      h += '<button type="button" class="bk-cta" data-act="apply">Apply for this home</button>';
    } else if (ready) {
      /* The notice goes ABOVE the button, not in fine print below it. A guest
         who has just picked dates and seen a price expects to apply; being
         quietly handed a different button reads as the site being broken.
         Say plainly that instant apply isn't available for these dates and
         what happens instead, before they click anything. */
      var daysOut = nightsBetween(this.earliest, this.moveIn);
      h += '<div class="bk-msg warn" style="margin-bottom:10px;">' +
           '<strong>These dates can\'t be booked instantly.</strong><br>' +
           'This home frees up on ' + fmtShort(this.earliest) + ', and your move-in is ' + daysOut +
           ' days after that. We only take instant applications within ' + BOOK_WINDOW_DAYS +
           ' days of a home opening, so we\'ll need to confirm these dates with you first. ' +
           'Send us your details below and we\'ll come back to you with your application link.' +
           '</div>';
      h += '<button type="button" class="bk-cta" data-act="inquire">Inquire about these dates</button>';
    } else if (q && q.reason === 'gap-too-large') {
      // Not quotable, but still a lead — give them a way through.
      h += '<button type="button" class="bk-cta" data-act="inquire">Inquire about these dates</button>';
    } else {
      h += '<button type="button" class="bk-cta" data-act="apply" disabled>Select dates to continue</button>';
    }

    h += '<div class="bk-steps"><div class="bk-steps-t">What happens next</div>';
    if (inWindow) {
      h += '<div class="bk-step"><span class="n">1</span><span>Apply online — ID, income and documents, all in one form.</span></div>';
      h += '<div class="bk-step"><span class="n">2</span><span>A $35 application fee is paid securely at the end.</span></div>';
      h += '<div class="bk-step"><span class="n">3</span><span>Once approved, you sign and move in. Fully furnished, move-in ready.</span></div>';
    } else {
      h += '<div class="bk-step"><span class="n">1</span><span>Send us your dates and contact details.</span></div>';
      h += '<div class="bk-step"><span class="n">2</span><span>We confirm the dates and send your application link.</span></div>';
      h += '<div class="bk-step"><span class="n">3</span><span>Once approved, you sign and move in. Fully furnished, move-in ready.</span></div>';
    }
    h += '</div></div>';

    h += '<div class="bk-contact"><h4>Questions?</h4><p>Not sure about dates, or need something specific? Send us a note.</p>' +
         '<form action="' + FORMSPREE + '" method="POST">' +
         '<input type="hidden" name="_subject" value="Question: ' + esc(u.name) + ' ' + esc(u.unitLabel) + '">' +
         '<input type="hidden" name="property" value="' + esc(u.name) + ' ' + esc(u.unitLabel) + '">' +
         '<div class="field"><label>Email</label><input type="email" name="email" required></div>' +
         '<div class="field"><label>Message</label><textarea name="message" placeholder="How can we help?"></textarea></div>' +
         '<button type="submit">Contact us</button></form></div>';

    this.el.innerHTML = h;
    this.bind();
  };

  BookingWidget.prototype.bind = function () {
    var self = this;
    this.el.querySelectorAll('[data-pick]').forEach(function (b) {
      b.addEventListener('click', function () { self.picking = b.dataset.pick; self.render(); });
    });
    this.el.querySelectorAll('[data-day]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = b.dataset.day.split('-').map(Number);
        self.onDayClick(new Date(p[0], p[1], p[2]));
      });
    });
    this.el.querySelectorAll('[data-pay]').forEach(function (b) {
      b.addEventListener('click', function () { self.payPlan = b.dataset.pay; self.render(); });
    });
    var rst = this.el.querySelector('[data-act="restore"]');
    if (rst) rst.addEventListener('click', function () { self.restorePrevious(); });
    var clr = this.el.querySelector('[data-act="clear"]');
    if (clr) clr.addEventListener('click', function () { self.clearDates(); });
    this.el.querySelectorAll('[data-rec-out]').forEach(function (b) {
      b.addEventListener('click', function () {
        var pi = b.dataset.recIn.split('-').map(Number);
        var po = b.dataset.recOut.split('-').map(Number);
        // Remember what they had so the suggestion can be undone.
        if (self.moveIn && self.moveOut) {
          self.prevSelection = { moveIn: self.moveIn, moveOut: self.moveOut };
        }
        self.dayHint = null;
        self.moveIn = new Date(pi[0], pi[1], pi[2]);
        self.moveOut = new Date(po[0], po[1], po[2]);
        self.picking = 'in';
        self.viewMonth = new Date(self.moveIn.getFullYear(), self.moveIn.getMonth(), 1);
        self.render();
      });
    });
    var prev = this.el.querySelector('[data-nav="prev"]');
    var next = this.el.querySelector('[data-nav="next"]');
    if (prev) prev.addEventListener('click', function () { self.viewMonth = addMonths(self.viewMonth, -1); self.render(); });
    if (next) next.addEventListener('click', function () { self.viewMonth = addMonths(self.viewMonth, 1); self.render(); });
    var cta = this.el.querySelector('[data-act="apply"]');
    if (cta) cta.addEventListener('click', function () { self.startApplication(); });
    var inq = this.el.querySelector('[data-act="inquire"]');
    if (inq) inq.addEventListener('click', function () { self.showApplyForm(); });
  };

  /* Always one month. This used to render two side by side whenever the
     container happened to be 600px or wider, so the same widget looked
     different on a unit page than in a narrower slot — and the two-up view
     squeezed both months small enough to be awkward to tap. One month is
     consistent everywhere and gives each date a full-size target. */
  BookingWidget.prototype.calendarHTML = function () {
    var h = '<div class="bk-cal"><div class="bk-months">';
    h += this.monthHTML(this.viewMonth, true, true);
    h += '</div>';
    h += '<div class="bk-legend"><span><i class="free"></i>Available</span><span><i class="taken"></i>Booked</span></div>';
    h += '</div>';
    return h;
  };

  BookingWidget.prototype.monthHTML = function (vm, showPrev, showNext) {
    var today = todayMid();
    var firstDow = new Date(vm.getFullYear(), vm.getMonth(), 1).getDay();
    var daysInMonth = new Date(vm.getFullYear(), vm.getMonth() + 1, 0).getDate();
    var atMin = vm.getFullYear() === today.getFullYear() && vm.getMonth() === today.getMonth();

    var h = '<div class="bk-month"><div class="bk-cal-head">';
    h += showPrev ? '<button type="button" class="bk-nav" data-nav="prev"' + (atMin ? ' disabled' : '') + '>&#8249;</button>' : '<span style="width:30px"></span>';
    h += '<div class="bk-cal-title">' + MONTHS[vm.getMonth()] + ' ' + vm.getFullYear() + '</div>';
    h += showNext ? '<button type="button" class="bk-nav" data-nav="next">&#8250;</button>' : '<span style="width:30px"></span>';
    h += '</div>';
    h += '<div class="bk-dow">' + DOW.map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div>';
    h += '<div class="bk-grid">';
    for (var i = 0; i < firstDow; i++) h += '<div class="bk-day blank"></div>';

    for (var day = 1; day <= daysInMonth; day++) {
      var d = new Date(vm.getFullYear(), vm.getMonth(), day);
      var cls = 'bk-day', disabled = false;

      if (d < today) { cls += ' past'; disabled = true; }
      else if (this.picking === 'out' && this.moveIn) {
        if (!this.canBeMoveOut(d) && !sameDay(d, this.moveIn)) { cls += ' disabled'; disabled = true; }
      } else if (this.isBusy(d)) { cls += ' disabled'; disabled = true; }

      if (sameDay(d, this.moveIn) || sameDay(d, this.moveOut)) {
        cls += ' sel';
        if (this.moveIn && this.moveOut) cls += sameDay(d, this.moveIn) ? ' start' : ' end';
      } else if (this.moveIn && this.moveOut && d > this.moveIn && d < this.moveOut) {
        cls += ' in-range';
      }

      h += '<button type="button" class="' + cls + '"' +
           (disabled ? ' disabled' : ' data-day="' + d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() + '"') +
           '>' + day + '</button>';
    }
    h += '</div></div>';
    return h;
  };

  /* ---------- application handoff ----------
     Sends the guest straight into the rental application app.

     This uses the app's PUBLIC listing route (/?property=<id>) — no token, no
     invite, nothing privileged in this file. The earlier plan here was to call
     /api/properties/:id/invites to mint a personal link, but that is an admin
     route behind ADMIN_PASSWORD, and that password can read every applicant's
     SSN and financial documents. It must never reach the browser. Personalised
     invites stay a staff action from the admin dashboard.

     The dates and quote are carried as query params so they can be shown back
     to the applicant / logged. They are display context only — the rate that
     counts is the one on the signed lease, and the app doesn't price anything. */
  BookingWidget.prototype.startApplication = function () {
    var u = this.unit, q = this.quote();
    if (!q || !q.ok) return;

    if (!u.applicationPropertyId) {
      // Not wired up yet — fall back to the inquiry form rather than sending
      // someone to a dead link.
      this.showApplyForm();
      return;
    }

    var base = window.APPLICATION_APP_URL || '';
    var url = base + '/?property=' + encodeURIComponent(u.applicationPropertyId) +
      '&move_in=' + encodeURIComponent(window.BroadlineRates.toISO(this.moveIn)) +
      '&move_out=' + encodeURIComponent(window.BroadlineRates.toISO(this.moveOut)) +
      '&quoted_monthly=' + encodeURIComponent(this.payPlan === 'monthly' ? q.payMonthly.monthlyRate : q.monthlyRate) +
      '&pay_plan=' + encodeURIComponent(this.payPlan);

    window.open(url, '_blank', 'noopener');
  };

  BookingWidget.prototype.showApplyForm = function () {
    var self = this;
    var q = this.quote();
    // Reachable with no quote at all when the gap is too large to price —
    // that's exactly the case most worth capturing, so don't bail.
    var priced = !!(q && q.ok);
    var u = this.unit;

    var h = '<div class="bk-card"><div class="bk-eyebrow">Inquiry</div><h3>Inquire about these dates</h3>';
    h += '<p class="bk-sub">' + esc(u.name) + ' ' + esc(u.unitLabel) + ' · ' + fmtShort(this.moveIn) + ' → ' + fmtShort(this.moveOut) +
         (priced
           ? '<br><strong style="color:var(--ink)">' + fmtMoney(q.monthlyRate) + '/month</strong> · ' + fmtMoney(q.total) + ' total · ' +
             fmtMoney(q.deposit) + ' refundable deposit'
           : '') + '</p>';
    /* Repeat why they're here. They arrived from a blocked apply, and landing
       on a bare name/email form with no explanation looks like the apply flow
       simply failed. */
    h += '<div class="bk-msg info" style="margin-bottom:14px;">' +
         (priced
           ? 'This isn\'t an application &mdash; these dates need confirming first. Send your details and we\'ll reply with your application link.'
           : 'We\'ll price these dates for you and come back with a quote.') + '</div>';
    h += '<form data-apply>';
    h += '<div class="bk-field"><label>Full name</label><input type="text" name="name" required></div>';
    h += '<div class="bk-field"><label>Email</label><input type="email" name="email" required></div>';
    h += '<div class="bk-field"><label>Phone</label><input type="tel" name="phone"></div>';
    h += '<div id="bk-apply-err"></div>';
    h += '<button type="submit" class="bk-cta">Send request</button></form>';
    h += '<button type="button" class="bk-back" data-back>&#8249; Back to dates</button></div>';

    this.el.innerHTML = h;
    this.el.querySelector('[data-back]').addEventListener('click', function () { self.render(); });
    this.el.querySelector('[data-apply]').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = this.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Sending…';
      self.submitApplication({ name: this.name.value, email: this.email.value, phone: this.phone.value })
        .then(function () { self.submitted = true; self.render(); })
        .catch(function () {
          btn.disabled = false; btn.textContent = 'Send request';
          document.getElementById('bk-apply-err').innerHTML =
            '<div class="bk-msg warn">Something went wrong sending that. Please email <a href="mailto:Info@broadlineliving.com" style="color:inherit;text-decoration:underline">Info@broadlineliving.com</a> and we\'ll sort it out.</div>';
        });
    });
  };

  /* Captures the lead so the team can issue the application link.

     TODO (blocked): once the rental-application-app exposes a scoped,
     invite-only API token, swap this for a call to a small serverless
     function that POSTs /api/properties/:id/invites and redirects the
     guest straight to the returned `link`. The admin password must never
     be embedded here — it can read every applicant's SSN and financials. */
  BookingWidget.prototype.submitApplication = function (data) {
    var u = this.unit, q = this.quote();
    var body = new FormData();
    body.append('_subject', 'APPLICATION REQUEST: ' + u.name + ' ' + u.unitLabel);
    body.append('property', u.name + ' ' + u.unitLabel);
    body.append('name', data.name);
    body.append('email', data.email);
    body.append('phone', data.phone || '');
    body.append('move_in', fmtShort(this.moveIn));
    body.append('move_out', fmtShort(this.moveOut));
    body.append('duration', durationLabel(nightsBetween(this.moveIn, this.moveOut)));
    /* No quote when the gap is too large to price — that lead still has to
       send. Report why instead of throwing on undefined fields. */
    if (q && q.ok) {
      body.append('quoted_monthly', fmtMoney(q.monthlyRate));
      body.append('quoted_total', fmtMoney(q.total));
      body.append('refundable_deposit', fmtMoney(q.deposit));
      body.append('due_at_signing', fmtMoney(this.payPlan === 'monthly' ? q.payMonthly.atSigning : q.payFull.atSigning));
      body.append('payment_plan', this.payPlan === 'monthly'
        ? 'Monthly installments (+' + q.payMonthly.upliftPct + '%) — rent ' + fmtMoney(q.payMonthly.rentPerInstallment) +
          ' x ' + q.payMonthly.installments + ', taxes paid at signing'
        : 'Paid upfront in full');
    } else {
      body.append('quoted_monthly', 'NOT QUOTED');
      body.append('quote_blocked_reason', (q && q.reason) || 'unknown');
      if (this.earliest) {
        body.append('home_opens', fmtShort(this.earliest));
        body.append('gap_days', String(nightsBetween(this.earliest, this.moveIn)));
      }
    }
    return fetch(FORMSPREE, { method: 'POST', body: body, headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('submit failed'); return r; });
  };

  /* ---------- public API ---------- */
  function mount(el, unitKey) { var w = new BookingWidget(el, unitKey); w.init(); return w; }

  function openModal(unitKey) {
    var u = window.BROADLINE_UNITS[unitKey];
    if (!u) return;
    var modal = document.getElementById('bk-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'bk-modal';
      modal.className = 'bk-modal';
      modal.innerHTML = '<div class="bk-modal-inner"><button type="button" class="bk-close" aria-label="Close">&times;</button>' +
                        '<div class="bk-modal-head"><div class="mh-name"></div><div class="mh-unit"></div></div>' +
                        '<div id="bk-modal-mount"></div></div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
      modal.querySelector('.bk-close').addEventListener('click', closeModal);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
    }
    modal.querySelector('.mh-name').textContent = u.name;
    modal.querySelector('.mh-unit').textContent = u.unitLabel;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    mount(document.getElementById('bk-modal-mount'), unitKey);
  }

  function closeModal() {
    var modal = document.getElementById('bk-modal');
    if (modal) modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  /* Sort tiers for the listings grid. Cards with a real open date sort by that
     date; everything undated falls below it, because "no known date" is not the
     same as "available far in the future" and shouldn't interleave with real
     dates. Fully-booked ranks above inquiry-only: it's still a live calendar,
     it just has nothing open right now. */
  var TIER_FULLY_BOOKED = 9e15;
  var TIER_NO_CALENDAR  = 1e16;

  /* Reorders the listing cards so the soonest-available home comes first.
     Runs once, after every availability lookup has settled — sorting as each
     one lands would make the grid visibly shuffle several times.

     Only reorders; it never hides anything. The hood/beds/search filters work
     by toggling display, so the two compose without either knowing about the
     other. Array.prototype.sort is stable, so cards sharing a tier keep the
     hand-curated order they have in the HTML. */
  function sortCardsByAvailability(ranks) {
    var grid = document.getElementById('listings');
    if (!grid) return;
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.pcard'));
    cards.sort(function (a, b) {
      var av = ranks.has(a) ? ranks.get(a) : TIER_NO_CALENDAR;
      var bv = ranks.has(b) ? ranks.get(b) : TIER_NO_CALENDAR;
      return av - bv;
    });
    // Re-appending an existing node moves it; no clone, so listeners survive.
    cards.forEach(function (c) { grid.appendChild(c); });
  }

  function hydrateBadges() {
    var badges = Array.prototype.slice.call(document.querySelectorAll('[data-avail-badge]'));
    var ranks = new Map();

    var jobs = badges.map(function (badge) {
      var key = badge.dataset.availBadge;
      var card = badge.closest ? badge.closest('.pcard') : null;
      var u = window.BROADLINE_UNITS[key];
      if (!u) { badge.style.display = 'none'; return Promise.resolve(); }
      badge.className = 'avail-badge loading';
      badge.innerHTML = '<span class="dot"></span>Checking…';
      return window.BroadlineAvailability.fetchBusyRanges(u.ruPropertyId).then(function (ranges) {
        // null = the feed failed. Don't claim "fully booked" off a network
        // error; hide the badge and let the card sort with the undated ones.
        if (ranges === null) {
          badge.style.display = 'none';
          if (card) ranks.set(card, TIER_NO_CALENDAR);
          return;
        }
        var e = window.BroadlineAvailability.earliestAvailable(ranges, MIN_NIGHTS);
        if (!e) {
          badge.className = 'avail-badge';
          badge.innerHTML = '<span class="dot"></span>Fully booked';
          if (card) ranks.set(card, TIER_FULLY_BOOKED);
          return;
        }
        if (e <= todayMid()) { badge.className = 'avail-badge now'; badge.innerHTML = '<span class="dot"></span>Available now'; }
        else { badge.className = 'avail-badge soon'; badge.innerHTML = '<span class="dot"></span>Available ' + fmtShort(e); }
        if (card) ranks.set(card, e.getTime());
      });
    });

    Promise.all(jobs).then(function () { sortCardsByAvailability(ranks); });
  }

  window.BroadlineBooking = { mount: mount, openModal: openModal, closeModal: closeModal, hydrateBadges: hydrateBadges };

  document.addEventListener('DOMContentLoaded', function () {
    var inline = document.getElementById('booking-widget');
    if (inline && inline.dataset.unitKey) mount(inline, inline.dataset.unitKey);
    hydrateBadges();
    document.querySelectorAll('[data-open-booking]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        openModal(btn.dataset.openBooking);
      });
    });
  });
})();
