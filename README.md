# Broadline Living — marketing website

Static site at **https://broadlineliving.com**. Furnished 30-night-plus
apartment listings, with live availability and instant pricing.

Everything you need to work on it is in this file. Read the three **Hard rules**
before changing a listing — each one is here because it was got wrong once.

---

## 1. Hosting and deploy

| | |
|---|---|
| Repo | `BroadlineLiving/BroadlineLivingWebsite`, branch `main` |
| Host | **GitHub Pages** (`CNAME` → broadlineliving.com) |
| Deploy | `git push origin main`. Live in ~60–120 seconds |
| Build step | **None.** Plain HTML/CSS/JS, served as-is |

There is no staging. A push is a publish.

> **The Revenue Engine is a different deployment.** It is a single HTML file on
> **Netlify**, dragged on by hand, and lives in `../revenue engine read me/`.
> Never cross the two.

### Caching will lie to you

GitHub Pages serves HTML with cache headers, so a normal reload can show the
**old** page for a while after a deploy. More than one "the change didn't work"
has been this.

- Verify with `curl -s https://broadlineliving.com/page.html | grep …`, or
- add `?x=1` to the URL, or press **Cmd+Shift+R**.

---

## 2. Layout

```
*.html                 28 unit pages + 7 others (index, availability,
                       about, contact, landlords, privacy, terms)
units-config.js        the unit registry — read by every page
rates.js               reads published_rates from Supabase, does the maths
booking.js             the booking widget, calendar, availability badges
availability.js        Rentals United iCal fetch + parse
booking.css styles.css styling
sitemap.xml            one <url> per page
<slug>-git/            one photo folder per unit
```

Every unit page loads: `units-config.js`, `rates.js`, `availability.js`,
`booking.js`, `styles.css`, `booking.css`, plus Leaflet from unpkg.

Unit pages are **near-identical copies of one template**. Adding a unit means
copying the closest existing page and substituting. There is no partial system —
a change to the shared chrome means editing 28 files. See §8.

---

## 3. Where data lives, and what must never live here

| Data | Source of truth |
|---|---|
| Listing copy, bed/bath, amenities | **Unit descriptions sheet** `12IEFbACFpFQs22CzeCG3VoRP0Z_a5K2Mh8EH8itqPsw` |
| Nightly rates | Supabase `published_rates`, written by the Revenue Engine |
| Availability | Rentals United iCal, fetched live in the browser |
| Bookings, units, expenses | Supabase, via the Revenue Engine |
| Applications | Separate Railway app (its own database) |

### Never put in this repo

`rates.js` exists precisely because the old `pricing.js` computed prices in the
browser, which shipped **base rent, markup curve, floors, decay and host fee** to
every visitor. Anyone could derive what Broadline pays and earns.

**Do not reintroduce base rent, markup, floors or any pricing config** to
`units-config.js` or `rates.js`. The only rate that may appear is a `directLet`
block's final guest-facing nightly — which is on the page anyway.

The Supabase **publishable** key in `rates.js` is fine: `published_rates` is
world-readable by design and holds only final rates. Other tables are locked to
that key.

---

## 4. units-config.js

One entry per bookable unit. 22 entries today.

```js
"sheridan-10f": {
  name: "The Shenandoah",       // display only
  unitLabel: "Unit 10F",        // display only
  ruPropertyId: "6494950",      // Rentals United ID. Also the key used to
                                // look up published rates AND fetch the iCal
  rooms: 3,                     // bedrooms + 1 (living room counts; studio = 1)
                                // drives the $2/room/night NYC unit fee
  applicationPropertyId: "5b93324f-…"   // null = falls back to inquiry form
}
```

`rooms` is a **tax input, not a display value.** Get it wrong and the occupancy
tax is wrong. Studio 1, 1BR 2, 2BR 3, 3BR 4.

Optional: `inquiryOnly` (never show a calendar), `directLet` (not on Rentals
United — see the header comment in the file; `union-city-2` is the only one).

**Six unit pages have no config entry** — `morningside-108`, `morningside-607`,
`william-3b/4a/5b/6a`. These are long-lease homes: no live calendar, no
published rates, "Inquire" instead of a price. That is deliberate.

---

## 5. How a price reaches the page

1. `rates.js` fetches `published_rates` for the unit's `ruPropertyId`
2. Sums the nightly for each date in the range
3. Applies the length-of-stay discount
4. Adds the vacancy-gap charge (empty nights before move-in)
5. Adds NYC occupancy tax: **5.875% of rent + $2.00/room/night**, exempt at
   180+ consecutive nights
6. `nightly` is shown on the site; `nightly_airbnb` (grossed up for the ~15.5%
   host fee) is what Rentals United pushes to Airbnb

**No published rate for a date = no quote.** It returns `ok:false` and the page
offers "Inquire". It never interpolates. A wrong public price is worse than
none.

### Constants are duplicated here

`rates.js` hardcodes values that also live in the engine's config:

```
LOS_DISCOUNT {1:0, 3:4, 6:5, 12:8}   PER_ROOM_NIGHT 2.00
TAX_EXEMPT_NIGHTS 180                GAP_SOFT_NIGHTS 5
GAP_RATE_SOFT 0.50                   GAP_RATE_HARD 0.85
```

They match today. **Change one in the engine's Config tab and this site keeps
the old value, silently.** If you touch pricing config, check both.

---

## 6. Adding a unit — the five edit points

Worked example: `sheridan-10f`, added 12 Oct 2026. Copy the closest existing
page (same building if there is one).

**1. Photos** → `10-sheridan-square-10F-git/`

- `sheridan-10F-1.jpg` … `-N.jpg`, max 1448px, JPEG q82, ~100–350 KB each
- `sheridan-10F-1-card.jpg` — 900×675, centre-cropped from photo 1
- Order: living → bedrooms → kitchen → bathrooms → laundry → **floor plan last**
- The gallery grid shows the **first five**; the rest open in the lightbox

**2. The page** → `sheridan-10f.html`. Substitute: `og:title`, `og:url`,
`canonical`, `twitter:title`, `<title>`, meta description, the `.unit` div, the
bed/bath `.meta` spans, `data-unit-key`, the gallery block, the `photos` array,
the "View All N Photos" count, the description, both amenity lists.

**3. `units-config.js`** — one entry (§4).

**4. `availability.html`** — **two** places:
   - a `.pcard` in the grid (`data-id`, `data-bld`, `data-hood`, `data-beds`)
   - a row in that building's `units:[…]` array, which drives the map popup

**5. `sitemap.xml`** — one `<url>`.

Then verify locally before pushing:

```bash
python3 -m http.server 8777
```

Check: page renders, booking widget shows a live calendar, the availability card
appears, and the browser console is clean.

---

## 7. Hard rules

### Listing copy is verbatim

Paste the **Description** cell from the descriptions sheet exactly. Convert
typography only (curly quotes → entities). Do not add neighbourhood colour,
subway lines, or "virtually staged" notes.

This exists because invented claims about subway lines once shipped.

### Amenities come from the sheet's cells, not the prose

Use the **Shared Amenities** and **Unit Amenities** cells. Writing the list by
hand from the description is how `atlas-34h` lost its library and bike storage
for months.

Older sheet tabs have no Shared Amenities cell — those pages were hand-written
and may be wrong. All five Atlas pages now share one 8-item list.

### "Flex" belongs in the prose, never the size label

The bed-count label — meta chip, availability card, `data-beds` — is always a
plain number: **"2 Bed"**. The sheet's "Flex 2 bedroom with small gap on second
bedroom wall" stays **in the description**, verbatim. It is a real fact a guest
booking sight-unseen should have.

### Central Air vs AC Units is a real distinction

Ducted vs through-wall. Not loose wording. Do not unify them.

---

## 8. Traps

### gviz caches; `/export` does not

Reading a Google Sheet via `…/gviz/tq?tqx=out:csv` can return **minutes-old
data with no indication**. It also **silently falls back to the first tab** when
you name one that does not exist — asking for a non-existent `Shenandoah #10F`
returned 30 Waterside Plaza's 3-bed copy.

Use `…/export?format=csv&gid=…` for anything you act on. Always check the
returned Building/Unit matches what you asked for.

### The availability page fans out to Rentals United

`hydrateBadges()` fires **one cross-origin iCal fetch per unit**, in parallel,
straight to `new.rentalsunited.com`. Today: 21 requests, ~430 ms median. Card
sorting waits on all of them. At ~100 units this is the first thing to break —
cache the busy ranges server-side before then.

### Card images all load upfront

They are CSS `background-image`, so **none can be lazy-loaded** without
converting to `<img loading="lazy">`. 24 cards ≈ 2.4 MB on `availability.html`.
At 100 units that is ~10 MB.

### The repo is image-heavy

`.git` is ~182 MB across 24 photo folders. Photos should move to object storage
before the portfolio doubles.

---

## 9. Scaling

Measured, not guessed. In order of what breaks first:

1. **~40–50 units** — availability page image weight
2. **~60–80 units** — the iCal fan-out
3. **~100 units** — git repo size, deploy times
4. **Already** — 28 hand-maintained near-duplicate pages. This is the real
   limit: a template change means editing every one, and amenity drift is the
   symptom. A build step (one template + `units-config.js` + the sheet) is the
   fix, and the right time is before the page count grows.

Nothing here needs replacing at 100 units. These are four independent,
incremental fixes.

---

## 10. Related systems

| | |
|---|---|
| Revenue Engine | `../revenue engine read me/` — single HTML file on Netlify, has its own README. Publishes `published_rates` |
| Supabase | `gtjlnuoqwnjxramexnmn` — `units`, `bookings`, `expenses`, `config`, `published_rates` |
| Rentals United | channel manager. Gets `nightly_airbnb` via `ru-push.js` |
| Master sheet | `1QokoMvLn2swJoztydjiCZ9jlzqXIPROvNiBIUdiowAQ` ("smarkey", owned by jack@). An older sheet owned by alessandro@ is **stale** |
| Descriptions sheet | `12IEFbACFpFQs22CzeCG3VoRP0Z_a5K2Mh8EH8itqPsw` |
| Applications | `rental-application-app-production.up.railway.app` — separate Railway app with its **own database** |

The only link between the site and the applications app is
`applicationPropertyId`. They share no data.
