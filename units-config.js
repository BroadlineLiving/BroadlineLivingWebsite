/* ============================================================
   BROADLINE LIVING — INSTANT QUOTE UNIT CONFIG
   ============================================================
   WEEKLY EDIT: update each unit's `baseRent` here to match whatever
   number you set on Airbnb from the pricing engine that week. That's
   the only value that needs to change — everything else (calendar,
   quote math) recalculates automatically.

   Do not add units here that aren't synced through Rentals United —
   long-term-lease units (136 William St, 30 Morningside Drive) are
   intentionally excluded; they don't have a live availability
   calendar and aren't part of the instant-quote flow.
   ============================================================ */

const BROADLINE_UNITS = {
  "thompson-b": {
    name: "59 Thompson Street",
    unitLabel: "Unit B",
    baseRent: 3500,
    ruApartmentId: "5204221"
  },
  "waterside-30-22f": {
    name: "30 Waterside Plaza",
    unitLabel: "Unit 22F",
    baseRent: 6153,
    ruApartmentId: "5011089"
  },
  "waterside-10-31f": {
    name: "10 Waterside Plaza",
    unitLabel: "Unit 31F",
    baseRent: 6296,
    ruApartmentId: "5426310"
  },
  "axel-24g": {
    name: "The Axel",
    unitLabel: "Unit 24G",
    baseRent: 4195,
    ruApartmentId: "5011093"
  },
  "axel-21b": {
    name: "The Axel",
    unitLabel: "Unit 21B",
    baseRent: 4370,
    ruApartmentId: "5011094"
  },
  "axel-27b": {
    name: "The Axel",
    unitLabel: "Unit 27B",
    baseRent: 4550,
    ruApartmentId: "5011097"
  },
  "rivington-10": {
    name: "7 Rivington Street",
    unitLabel: "Unit 10",
    baseRent: 5100,
    ruApartmentId: "5011099"
  },
  "aurora-2301": {
    name: "The Aurora",
    unitLabel: "Unit 2301",
    baseRent: 4200,
    ruApartmentId: "5400606"
  }
};

if (typeof window !== 'undefined') {
  window.BROADLINE_UNITS = BROADLINE_UNITS;
}
