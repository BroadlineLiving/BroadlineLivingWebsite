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
     directLet             Optional. Set for a home that is NOT on Rentals
                           United and so has no live calendar and no published
                           rates — see the DIRECT LETS note below. Mutually
                           exclusive with ruPropertyId.
     applicationPropertyId Property id in the rental-application app.
                           Guests are sent to
                           <APP>/?property=<applicationPropertyId>.
                           null = not wired up yet; the unit shows
                           "Inquire" instead of an apply button.

   DIRECT LETS (no Rentals United)
   A `directLet` block is the one place a rate may appear in this file, and
   only ever the FINAL GUEST-FACING NIGHTLY. That number is on the page
   anyway; it reveals nothing. What must never appear here is how it was
   built — the owner's figure, the split, the margin. Those stay out of the
   browser exactly as they do for every other home.

   Fields:
     nightly            final guest-facing nightly, before any LOS discount
     minNights          minimum stay
     availableFrom      ISO date; everything before it is blocked out
     coverThroughMonths how far past availableFrom we will quote (default 24)
     noOccupancyTax     true for homes outside New York City, where the NYC
                        hotel room occupancy tax simply does not apply
     gapRate            fraction of the nightly charged for each empty night
                        between the home opening and the move-in. Overrides
                        the site's usual two-tier 50%/85% split with one flat
                        rate, because a home we are trialling for an owner is
                        not carrying the same cost of an empty night as one we
                        hold a lease on. Omit to use the site default.
     bookWindowDays     how far past the opening date a guest may still apply
                        instantly. Omit to use the site default (5).
     blocked            [{start,end}] ISO ranges to block by hand. THERE IS NO
                        LIVE CALENDAR for these homes — if one gets booked,
                        add the range here or the site will keep selling it.
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
    applicationPropertyId: "ec4cab02-87b3-4627-99b7-66c1dc63e44e"
  },
  "atlas-39h": {
    name: "Atlas New York",
    unitLabel: "Unit 39H",
    ruPropertyId: "5957163",
    rooms: 3,                    // flex 2BR — living room + 2 bedrooms
    applicationPropertyId: "7b2dbc85-c78f-4f43-9ae6-20cb437c80cf"
  },
  "mott-4": {
    name: "223 Mott Street",
    unitLabel: "Unit 4",
    ruPropertyId: "6066885",
    rooms: 2,                    // 1BR
    applicationPropertyId: "5c6021c0-80db-4e8d-b6a2-f2fd8901dcd9"
  },
  "park-row-8e": {
    name: "15 Park Row",
    unitLabel: "Unit 8E",
    ruPropertyId: "6198979",
    rooms: 2,                    // 1BR
    applicationPropertyId: "65339e39-9ba6-4add-a3c4-ba369bfaa1fa"
  },
  "park-row-17g": {
    name: "15 Park Row",
    unitLabel: "Unit 17G",
    ruPropertyId: "6240263",
    rooms: 1,                    // studio
    applicationPropertyId: "4c3e9377-42ad-482c-8ace-c5a6ff5933cc"
  },
  "park-row-17f": {
    name: "15 Park Row",
    unitLabel: "Unit 17F",
    ruPropertyId: "6278876",
    rooms: 2,                    // 1BR
    applicationPropertyId: "aeb0385f-589c-4085-b328-bec433564e13"
  },
  "lawrence-2404": {
    name: "Lawrence Tower",
    unitLabel: "Unit 2404",
    ruPropertyId: "6339688",
    rooms: 2,                    // 1BR
    applicationPropertyId: "f40489be-53d8-4714-b2d4-7d112ab2e21b"
  },
  "lawrence-2401": {
    name: "Lawrence Tower",
    unitLabel: "Unit 2401",
    ruPropertyId: "5676646",
    rooms: 2,                    // 1BR
    applicationPropertyId: "45b02598-f048-40ba-a62c-24411f0d9dc7"
  },
  /* 314 28th Street, Apt 2 — Union City, NJ. Let directly for the owner, not
     through Rentals United: no iCal feed, no published rates, no Airbnb
     listing of ours. Priced from a flat nightly below, with the standard
     length-of-stay discount still applied on top. New Jersey, so the NYC
     occupancy tax does not apply and no tax line is shown. */
  "union-city-2": {
    name: "314 28th Street",
    unitLabel: "Apartment 2",
    ruPropertyId: null,
    rooms: 4,                    // 3BR — unused here, there is no room tax
    applicationPropertyId: "9d36e76c-ca5d-4e69-877a-3f70de96c8c4",
    directLet: {
      nightly: 283.3333,
      minNights: 30,
      availableFrom: "2026-10-08",
      coverThroughMonths: 24,
      noOccupancyTax: true,
      gapRate: 0.25,
      bookWindowDays: 10,
      blocked: []
    }
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
