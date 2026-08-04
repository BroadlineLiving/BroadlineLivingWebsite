/* ============================================================
   BROADLINE LIVING — LIVE AVAILABILITY (Rentals United iCal)
   Fetches each unit's public iCal feed directly (CORS-open) and
   exposes booked date ranges + earliest-available date. No backend,
   no build step — just a client-side fetch + a tiny VEVENT parser.
   ============================================================ */

function icalUrlFor(ruApartmentId) {
  return `https://new.rentalsunited.com/iCal/iCal.ashx?apa=${ruApartmentId}&google=1`;
}

/* Parses DTSTART/DTEND (VALUE=DATE, all-day) pairs out of a VEVENT block.
   RU's feed uses whole-day blocks tagged SUMMARY:Unavailable. */
function parseICalBusyRanges(icalText) {
  const ranges = [];
  const events = icalText.split('BEGIN:VEVENT').slice(1);
  for (const block of events) {
    const startMatch = block.match(/DTSTART[^:]*:(\d{8})/);
    const endMatch = block.match(/DTEND[^:]*:(\d{8})/);
    if (!startMatch || !endMatch) continue;
    ranges.push({
      start: isoFromICalDate(startMatch[1]),
      end: isoFromICalDate(endMatch[1])
    });
  }
  return ranges;
}

function isoFromICalDate(d) {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function dateFromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayMidnight() {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

/* Fetches and parses a unit's live busy ranges. Returns [] on any
   fetch failure so a feed hiccup shows "fully open" rather than
   crashing the calendar — caller should still treat that cautiously. */
async function fetchBusyRanges(ruApartmentId) {
  try {
    const res = await fetch(icalUrlFor(ruApartmentId));
    if (!res.ok) throw new Error('iCal fetch failed: ' + res.status);
    const text = await res.text();
    return parseICalBusyRanges(text);
  } catch (err) {
    console.error('Availability fetch failed for', ruApartmentId, err);
    return null; // null = unknown/failed, distinct from [] = confirmed open
  }
}

function isDateBusy(date, busyRanges) {
  const t = date.getTime();
  return busyRanges.some(r => t >= dateFromISO(r.start).getTime() && t < dateFromISO(r.end).getTime());
}

/* Earliest date, starting from today, that begins a continuous open
   stretch of at least `minNights` (default 28, matching the 1-month
   minimum stay). Scans up to 3 years out as a sane bound. */
function earliestAvailable(busyRanges, minNights = 28) {
  if (!busyRanges) return null;
  let cursor = todayMidnight();
  const horizon = new Date(cursor.getFullYear() + 3, cursor.getMonth(), cursor.getDate());
  while (cursor < horizon) {
    if (!isDateBusy(cursor, busyRanges)) {
      // check the run from here is long enough
      let ok = true;
      for (let n = 1; n < minNights; n++) {
        const d = new Date(cursor);
        d.setDate(d.getDate() + n);
        if (isDateBusy(d, busyRanges)) { ok = false; cursor = d; break; }
      }
      if (ok) return cursor;
    } else {
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return null; // nothing open in the scan window
}

if (typeof window !== 'undefined') {
  window.BroadlineAvailability = {
    fetchBusyRanges,
    isDateBusy,
    earliestAvailable,
    dateFromISO
  };
}
