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
  var BOOK_WINDOW_DAYS = 3;
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
  function durationLabel(nights) {
    var m = nights / 30.4375;
    if (m >= 11.5) return '12 months';
    if (m >= 1.85) return Math.round(m) + ' months';
    var whole = Math.floor(m);
    var days = nights - Math.round(whole * 30.4375);
    if (whole >= 1 && days > 2) return whole + ' month' + (whole > 1 ? 's' : '') + ' & ' + days + ' days';
    return whole >= 1 ? whole + ' month' : nights + ' nights';
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
    if (this.picking === 'out' && this.moveIn) {
      if (this.canBeMoveOut(d)) { this.moveOut = d; this.picking = 'in'; }
      else if (d <= this.moveIn) { this.moveIn = d; this.moveOut = null; }
      else return;
    } else {
      if (this.isBusy(d) || d < todayMid()) return;
      this.moveIn = d; this.moveOut = null; this.picking = 'out';
    }
    this.render();
  };

  /* Quotes come from the rates the Revenue Engine published — no pricing model
     runs in the browser any more. If a night in the range isn't published,
     this returns ok:false and the UI must offer "Inquire", never a guess. */
  BookingWidget.prototype.quoteFor = function (moveIn, moveOut) {
    if (!this.ratesLoaded) return { ok: false, reason: 'loading' };
    return window.BroadlineRates.quote(this.rates, moveIn, moveOut, this.unit.rooms);
  };
  BookingWidget.prototype.quote = function () {
    if (!this.moveIn || !this.moveOut) return null;
    return this.quoteFor(this.moveIn, this.moveOut);
  };

  /* True when the chosen move-in is close enough to the home's next-open date
     to allow a self-serve application. If availability never loaded we don't
     know the open date, so we fail closed to "enquire" rather than opening the
     apply flow on an assumption. */
  BookingWidget.prototype.withinBookingWindow = function () {
    if (!this.moveIn || !this.earliest) return false;
    var slack = nightsBetween(this.earliest, this.moveIn);
    return slack <= BOOK_WINDOW_DAYS;   // negative = before it frees up; the calendar already blocks that
  };

  /* ---------- stay recommendations ----------
     Always surfaces longer terms: a 12-month deal (flat 35%), and an option
     that ends in peak season so the home re-lets well. Only suggests ranges
     that are actually free on the live calendar. */
  BookingWidget.prototype.recommendations = function () {
    if (!this.moveIn || !this.moveOut) return [];
    var current = this.quote();
    if (!current || !current.ok) return [];
    var self = this;
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
      out.push({
        moveIn: moveIn, moveOut: moveOut, nights: n, quote: q, flavor: flavor,
        save: current.monthlyRate - q.monthlyRate
      });
    }

    /* 1. Same stay length, but starting the day the home is actually free.
       Booking after the opening makes the guest absorb the empty "burn days"
       through the vacancy-recovery surcharge — moving in sooner removes it. */
    if (this.earliest && this.earliest < this.moveIn) {
      consider(this.earliest, addDays(this.earliest, curNights), 'nogap');
    }

    /* 2 & 3. End dates that land in May/June/July, when the home re-lets best.
       Offer the longest such stay within 12 months, plus one nearer 6 months. */
    var cands = this.peakEndCandidates(this.moveIn).filter(function (d) {
      return nightsBetween(self.moveIn, d) > curNights && self.rangeIsFree(self.moveIn, d);
    });
    if (cands.length) {
      var longest = cands[cands.length - 1];
      consider(this.moveIn, longest, 'long');
      var target = 183; // ~6 months
      var mid = cands.reduce(function (best, d) {
        return Math.abs(nightsBetween(self.moveIn, d) - target) <
               Math.abs(nightsBetween(self.moveIn, best) - target) ? d : best;
      }, cands[0]);
      if (!sameDay(mid, longest)) consider(this.moveIn, mid, 'mid');
    }

    return out;
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
         '<div class="lbl">Move-in</div><div class="val' + (this.moveIn ? '' : ' empty') + '">' +
         (this.moveIn ? fmtShort(this.moveIn) : 'Select date') + '</div></button>';
    h += '<button type="button" class="bk-slot' + (this.picking === 'out' ? ' active' : '') + '" data-pick="out">' +
         '<div class="lbl">Move-out</div><div class="val' + (this.moveOut ? '' : ' empty') + '">' +
         (this.moveOut ? fmtShort(this.moveOut) : 'Select date') + '</div></button>';
    h += '</div>';

    h += loading ? '<div class="bk-skel bk-skel-cal"></div>' : this.calendarHTML();

    if (!loading && this.moveIn && !this.moveOut) {
      h += '<div class="bk-msg info">Now choose your move-out date — minimum stay is one month (' + MIN_NIGHTS + ' nights).</div>';
    }

    // stay recommendations
    var recs = this.recommendations();
    var q = this.quote();
    if (q && q.ok && recs.length) {
      h += '<div class="bk-recs"><div class="bk-recs-t">Stay recommendations</div><div class="bk-recs-scroll">';
      h += '<div class="bk-rec current"><div class="bk-rec-flag neutral">Your dates</div>' +
           '<div class="bk-rec-amt">' + fmtMoney(q.monthlyRate) + '<span class="u">/mo</span></div>' +
           '<div class="bk-rec-dur">' + durationLabel(q.nights) + '</div></div>';
      recs.forEach(function (r, i) {
        /* Only claim savings when the longer stay is genuinely cheaper per
           month — spanning summer can cost more, and a false "save" would
           be misleading. */
        var saves = r.save > 0;
        var LABELS = {
          nogap: 'Move in when it opens',
          long: saves ? 'Stay and save' : 'Stay longer',
          mid: saves ? 'Stay and save' : 'Stay longer'
        };
        var flag = saves
          ? '<div class="bk-rec-flag">Save ' + fmtMoney(r.save) + '/mo</div>'
          : '<div class="bk-rec-flag neutral">Longer stay</div>';
        var iso = function (d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
        h += '<button type="button" class="bk-rec" data-rec-in="' + iso(r.moveIn) + '" data-rec-out="' + iso(r.moveOut) + '"' +
             ' style="animation-delay:' + (i * 45) + 'ms">' + flag +
             '<div class="bk-rec-lbl">' + LABELS[r.flavor] + '</div>' +
             '<div class="bk-rec-amt">' + fmtMoney(r.quote.monthlyRate) + '<span class="u">/mo</span></div>' +
             '<div class="bk-rec-dur">' + (r.flavor === 'nogap' ? fmtShort(r.moveIn) + ' start' : durationLabel(r.nights)) + '</div></button>';
      });
      h += '</div></div>';
    }

    // quote
    h += '<div class="bk-quote">';
    if (q && q.ok) {
      h += '<div class="bk-quote-main"><span class="bk-quote-amt">' + fmtMoney(q.monthlyRate) + '</span><span class="bk-quote-per">/ month</span></div>';
      h += '<div class="bk-quote-note">' + fmtMoney(q.nightlyRate) + ' per night · ' + q.nights + ' nights</div>';
      h += '<div class="bk-lines">';
      h += '<div class="bk-line"><span>' + fmtShort(this.moveIn) + ' → ' + fmtShort(this.moveOut) + '</span><span>' + durationLabel(q.nights) + '</span></div>';
      h += '<div class="bk-line"><span>Rent</span><span>' + fmtMoney(q.rentTotal) + '</span></div>';
      /* Tax is itemised, not folded in. Broadline collects and remits NYC
         occupancy tax on direct bookings, and stays of 180+ nights are exempt
         outright — worth showing, since it is a real reason to book longer. */
      if (q.tax.exempt) {
        h += '<div class="bk-line"><span>NYC occupancy tax</span><span>Exempt (180+ nights)</span></div>';
      } else {
        h += '<div class="bk-line"><span>NYC occupancy tax</span><span>' + fmtMoney(q.tax.total) + '</span></div>';
      }
      h += '<div class="bk-line total"><span>Estimated total</span><span>' + fmtMoney(q.total) + '</span></div>';
      h += '</div>';
      h += '<div class="bk-fine">Fully furnished. No booking fees. ' +
           (q.tax.exempt
             ? 'Stays of 180 nights or more are exempt from NYC occupancy tax. '
             : 'NYC occupancy tax (5.875% plus $2 per room per night) is shown above. ') +
           (q.utilitiesSeparate
             ? '<b>On stays of 6 months or longer, utilities are billed separately.</b>'
             : 'Utilities and Wi-Fi are included.') +
           '</div>';
    } else if (q && q.reason === 'loading') {
      h += '<div class="bk-quote-empty">Loading rates…</div>';
    } else if (q && q.reason === 'unavailable') {
      h += '<div class="bk-quote-empty">Pricing is temporarily unavailable — please get in touch and we\'ll quote you directly.</div>';
    } else if (q && (q.reason === 'not-published' || q.reason === 'no-rate-for-date')) {
      h += '<div class="bk-quote-empty">We don\'t have published pricing for those dates yet — send us an enquiry and we\'ll come back with a rate.</div>';
    } else if (q && q.reason === 'min-stay') {
      h += '<div class="bk-quote-empty">Minimum stay is ' + q.minNights + ' nights.</div>';
    } else {
      h += '<div class="bk-quote-empty">Select your dates to see pricing.</div>';
    }
    h += '</div>';

    /* Book vs. enquire.
       Instant booking is only offered when the move-in is within a few days of
       the date the home actually frees up. Further out, the rate is still a
       real quote but the dates need a human — and this cannot be enforced on
       Rentals United (no such setting), so RU stays request-to-book. */
    var ready = !!(q && q.ok);
    var inWindow = ready && this.withinBookingWindow();
    if (ready && inWindow) {
      h += '<button type="button" class="bk-cta" data-act="apply">Apply for this home</button>';
    } else if (ready) {
      h += '<button type="button" class="bk-cta" data-act="inquire">Enquire about these dates</button>';
      h += '<div class="bk-fine" style="margin-top:8px;">Move-in is more than ' + BOOK_WINDOW_DAYS +
           ' days after this home frees up (' + fmtShort(this.earliest) + '), so we\'ll confirm these dates with you directly before you apply.</div>';
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
    this.el.querySelectorAll('[data-rec-out]').forEach(function (b) {
      b.addEventListener('click', function () {
        var pi = b.dataset.recIn.split('-').map(Number);
        var po = b.dataset.recOut.split('-').map(Number);
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

  BookingWidget.prototype.calendarHTML = function () {
    var two = this.el.clientWidth >= 600;
    var h = '<div class="bk-cal"><div class="bk-months' + (two ? ' two' : '') + '">';
    h += this.monthHTML(this.viewMonth, true, !two);
    if (two) h += this.monthHTML(addMonths(this.viewMonth, 1), false, true);
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
      // Not wired up yet — fall back to the enquiry form rather than sending
      // someone to a dead link.
      this.showApplyForm();
      return;
    }

    var base = window.APPLICATION_APP_URL || '';
    var url = base + '/?property=' + encodeURIComponent(u.applicationPropertyId) +
      '&move_in=' + encodeURIComponent(window.BroadlineRates.toISO(this.moveIn)) +
      '&move_out=' + encodeURIComponent(window.BroadlineRates.toISO(this.moveOut)) +
      '&quoted_monthly=' + encodeURIComponent(q.monthlyRate);

    window.open(url, '_blank', 'noopener');
  };

  BookingWidget.prototype.showApplyForm = function () {
    var self = this;
    var q = this.quote();
    if (!q || !q.ok) return;
    var u = this.unit;

    var h = '<div class="bk-card"><div class="bk-eyebrow">Almost there</div><h3>Enquire about these dates</h3>';
    h += '<p class="bk-sub">' + esc(u.name) + ' ' + esc(u.unitLabel) + ' · ' + fmtShort(this.moveIn) + ' → ' + fmtShort(this.moveOut) + '<br>' +
         '<strong style="color:var(--ink)">' + fmtMoney(q.monthlyRate) + '/month</strong> · ' + fmtMoney(q.total) + ' total' +
         (q.tax.exempt ? ' · tax exempt (180+ nights)' : ' · incl. NYC occupancy tax') + '</p>';
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
    body.append('duration', durationLabel(q.nights));
    body.append('quoted_monthly', fmtMoney(q.monthlyRate));
    body.append('quoted_total', fmtMoney(q.total));
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

  function hydrateBadges() {
    document.querySelectorAll('[data-avail-badge]').forEach(function (badge) {
      var key = badge.dataset.availBadge;
      var u = window.BROADLINE_UNITS[key];
      if (!u) { badge.style.display = 'none'; return; }
      badge.className = 'avail-badge loading';
      badge.innerHTML = '<span class="dot"></span>Checking…';
      window.BroadlineAvailability.fetchBusyRanges(u.ruPropertyId).then(function (ranges) {
        if (ranges === null) { badge.style.display = 'none'; return; }
        var e = window.BroadlineAvailability.earliestAvailable(ranges, MIN_NIGHTS);
        if (!e) { badge.className = 'avail-badge'; badge.innerHTML = '<span class="dot"></span>Fully booked'; return; }
        if (e <= todayMid()) { badge.className = 'avail-badge now'; badge.innerHTML = '<span class="dot"></span>Available now'; }
        else { badge.className = 'avail-badge soon'; badge.innerHTML = '<span class="dot"></span>Available ' + fmtShort(e); }
      });
    });
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
