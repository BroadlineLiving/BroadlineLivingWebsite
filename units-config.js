/* ============================================================
   BROADLINE LIVING — UNIT CONFIG
   ============================================================
   NO WEEKLY EDIT NEEDED ANY MORE. Rates used to live here as
   `baseRent` and had to be hand-updated every week. They don't:
   the Revenue Engine publishes final nightly rates to Supabase
   (`published_rates`) and the site reads them live. Publishing
   from the engine updates this website and Rentals United at the
   same time, from the same numbers.

   NEVER put baseRent, markup, floors or any pricing config in
   this file. It is served to every visitor. Anything here is
   public and would expose what Broadline pays and earns.

   Only units synced through Rentals United belong here. The
   long-lease units (136 William St, 30 Morningside Drive) are
   intentionally excluded — no live calendar, no instant quote.

   FIELDS
     name / unitLabel      display only
     ruPropertyId          Rentals United PropertyID. Also the key
                           this site uses to look up published rates.
     rooms                 bedrooms + 1 (the living room counts;
                           a studio is 1). Drives the $2/room/night
                           portion of NYC occupancy tax.
     inquiryOnly           Optional. true = never show a calendar on the unit
                           page; show "Inquiry only" and an inquiry form
                           instead. Use for homes that are let through us
                           rather than booked online. The page also falls
                           back to this on its own when a home is fully
                           booked, has no published rates, or its calendar
                           feed is down.
     applicationPropertyId Property id in the rental-application app.
                           Guests are sent to
                           <APP>/?property=<applicationPropertyId>.
                           null = not wired up yet; the unit shows
                           "Inquire" instead of an apply button.
   ============================================================ */

/* Rental application app. The apply link is a PUBLIC route — no token, no
   invite needed — so nothing privileged is embedded here. Do NOT ever put the
   app's ADMIN_PASSWORD in this repo: it can read every applicant's SSN and
   financial documents. Invite-based links stay a staff-side action. */
const APPLICATION_APP_URL = 'https://rental-application-app-production.up.railway.app';

const BROADLINE_UNITS = {
  "thompson-b": {
    name: "59 Thompson Street",
    unitLabel: "Unit B",
    ruPropertyId: "5204221",
    rooms: 1,                    // studio
    applicationPropertyId: "01fc418d-ce98-460e-94d3-5f45458dd15f"
  },
  "waterside-30-22f": {
    name: "30 Waterside Plaza",
    unitLabel: "Unit 22F",
    ruPropertyId: "5011089",
    rooms: 4,                    // 3BR
    // CANONICAL 22F record (6 applications, created 2026-08-03). A second,
    // older 22F record exists — 265c8807-5c41-45fe-9a68-4d041910c89a, with 5
    // applications — and is a known duplicate awaiting cleanup. Do not point
    // the site at that one or applicants land in the wrong pile.
    applicationPropertyId: "e2054e94-6bdb-4f1d-9f58-de53a1693758"
  },
  "waterside-10-31f": {
    name: "10 Waterside Plaza",
    unitLabel: "Unit 31F",
    ruPropertyId: "5426310",
    rooms: 4,                    // 3BR
    applicationPropertyId: "e8143060-e2f7-4756-841a-529ad3174d0b"
  },
  "axel-24g": {
    name: "The Axel",
    unitLabel: "Unit 24G",
    ruPropertyId: "5011093",
    rooms: 2,                    // 1BR
    applicationPropertyId: "8f9234e0-2b9c-4df5-92d7-6dec88cb0500"
  },
  "axel-21b": {
    name: "The Axel",
    unitLabel: "Unit 21B",
    ruPropertyId: "5011094",
    rooms: 2,                    // 1BR
    applicationPropertyId: "b0f0c4e9-78f4-4802-9ba5-0c254f83e863"
  },
  "axel-27b": {
    name: "The Axel",
    unitLabel: "Unit 27B",
    ruPropertyId: "5011097",
    rooms: 2,                    // 1BR
    applicationPropertyId: "495841cc-032e-4def-b257-1c1fb2cc3469"
  },
  "rivington-10": {
    name: "7 Rivington Street",
    unitLabel: "Unit 10",
    ruPropertyId: "5011099",
    rooms: 3,                    // 2BR
    // The app's record has no unitInfo set ("7 rivington", unit blank). Fine
    // for routing — the id is what matters — but worth Jack filling in so
    // applications are identifiable if a second Rivington unit is ever added.
    applicationPropertyId: "cf9ddf91-a116-458b-b8e1-fdec541986d2"
  },
  "aurora-2301": {
    name: "The Aurora",
    unitLabel: "Unit 2301",
    ruPropertyId: "5400606",
    rooms: 1,                    // studio
    applicationPropertyId: "53be119f-ef6c-49a7-8f60-84d297c23693"
  },
  "sheridan-10a": {
    name: "The Shenandoah",
    unitLabel: "Unit 10A",
    ruPropertyId: "5777690",
    rooms: 2,                    // 1BR
    applicationPropertyId: "cdf4538f-645b-411e-ae13-19bbf73603e6"
  },
  "atlas-34h": {
    name: "Atlas New York",
    unitLabel: "Unit 34H",
    ruPropertyId: "5957043",
    rooms: 3,                    // flex 2BR — living room + 2 bedrooms
    applicationPropertyId: null
  },
  "atlas-39h": {
    name: "Atlas New York",
    unitLabel: "Unit 39H",
    ruPropertyId: "5957163",
    rooms: 3,                    // flex 2BR — living room + 2 bedrooms
    applicationPropertyId: null
  },
  "lawrence-2401": {
    name: "Lawrence Tower",
    unitLabel: "Unit 2401",
    ruPropertyId: "5676646",
    rooms: 2,                    // 1BR
    applicationPropertyId: "45b02598-f048-40ba-a62c-24411f0d9dc7"
  }
};

/* Back-compat: booking.js historically read `ruApartmentId`. Keep both names
   pointing at the same value so nothing silently reads undefined. */
Object.keys(BROADLINE_UNITS).forEach(function (k) {
  BROADLINE_UNITS[k].ruApartmentId = BROADLINE_UNITS[k].ruPropertyId;
});

if (typeof window !== 'undefined') {
  window.BROADLINE_UNITS = BROADLINE_UNITS;
  window.APPLICATION_APP_URL = APPLICATION_APP_URL;
}
