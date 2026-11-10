# AGENTS.md

Operating rules for coding agents working in this repo.

`README.md` is the full reference and it is accurate. Read it before any
non-trivial change. This file is the short contract: the things that cause real
damage if you get them wrong.

---

## 1. A push is a publish

Static site, GitHub Pages, branch `main`, no build step and no staging. Pushing
to `main` puts the change in front of customers in 60 to 120 seconds.

**Open a pull request. Do not push to `main`** unless the owner has said to in
that specific request.

More than one person and more than one agent works in this repo. Rebase before
you push, and only commit files your task actually touched.

---

## 2. Never put pricing internals in this repo

Every file here is served to every visitor and the repo is public.

**Do not add base rent, markup, floors, decay, host fee or any pricing config to
`units-config.js`, `rates.js` or any page.** An earlier `pricing.js` computed
prices in the browser and shipped exactly that, which let anyone derive what the
business pays and earns. That is why `rates.js` reads finished rates from
Supabase instead.

The one rate that may appear in `units-config.js` is a `directLet` block's final
guest-facing `nightly`, which is already on the page.

The Supabase publishable key in `rates.js` is fine and is meant to be there.
`published_rates` is world-readable by design and holds only final rates. Never
add any other key, token or password.

---

## 3. Listing copy and amenities are copied, not written

Source of truth is the Unit descriptions sheet, id in README §10.

- The description is **verbatim** from that unit's Description cell. Convert
  typography only. Do not add neighbourhood colour, subway lines, walk times or
  staging notes. Invented subway claims have shipped before.
- Amenity lists come from the **Shared Amenities** and **Unit Amenities** cells,
  not from reading the prose. Hand-written lists are how a unit silently lost
  amenities for months.
- The bed label is a plain number, "2 Bed". Words like "Flex" stay in the
  description where the sheet put them.
- "Central Air" and "AC Units" are different things. Do not unify them.

Read sheets with `/export?format=csv&gid=…`, never `gviz`, which serves stale
data and silently falls back to the first tab. Check the Building and Unit in
what comes back match what you asked for.

---

## 4. `rooms` is a tax input

In `units-config.js`, `rooms` is bedrooms plus one, because the living room
counts. Studio 1, 1BR 2, 2BR 3, 3BR 4. It drives the $2 per room per night NYC
occupancy fee. Getting it wrong charges guests the wrong tax. It is not a
display value.

---

## 5. Adding or changing a unit touches five places

1. Photo folder `<slug>-git/`
2. The page `<key>.html`, copied from the closest existing unit
3. `units-config.js`
4. `availability.html`, in **two** spots: the `.pcard` in the grid and the row
   in that building's `units:[…]` array that drives the map popup
5. `sitemap.xml`

Miss number 4 and the unit is invisible on the availability page or missing from
the map. See README §6 for the full substitution list inside the page.

---

## 6. Image conventions

- **The lightbox frame is 4:3** with `object-fit: contain`, and the backdrop
  behind it is a blurred copy of the photo. A photo that is not 4:3 sits in grey
  bands. Crop photos to 4:3 where the composition allows; **pad floor plans to
  4:3 on white**, since a plan cannot be cropped.
- **Logos are drawn by `photo-logo.js`**, bottom left, over every gallery tile,
  lightbox image and card. Never stamp a logo into an image file. If a supplied
  image arrives with one baked in, remove it or you get two.
- Floor plan tiles use
  `background-size:contain;background-repeat:no-repeat;background-color:#fff`
  so the plan is not cropped.
- The gallery grid shows the **first five** tiles, CSS hides the rest, and the
  `photos` array holds them all. The button reads "View All N Photos" with N the
  full count.
- Photo order: living, bedrooms, kitchen, bathrooms, laundry, **floor plan
  last**. Card image is `<slug>-1-card.jpg`, 900px wide, cropped from photo 1.
- **If you replace an image but keep its filename, add or bump a `?v=N` query on
  every reference to it** (gallery tile and `photos` array). Otherwise the CDN
  serves the old image for ten minutes and the change looks broken.
- A new availability card must use `<div class="img" data-bg="…">`, not an
  inline `background-image`. An IntersectionObserver fills it in on scroll, and
  the card carousel reads the same attribute. An inline background never loads.

---

## 7. Prices only show where the guest can also apply

The booking widget quotes a move-in up to 5 days past the date a home opens, the
same window as instant apply, wired so the two cannot drift. Past it the guest
is offered Inquire. Widening it once showed guests rates for dates they could not
book. Do not widen it without being asked.

No published rate for a date means no quote. The code returns `ok:false` and
offers Inquire. **Never interpolate a missing rate.** A wrong public price is
worse than no price.

---

## 8. Do not state availability, pricing or showing times yourself

Anything a guest reads about what is free, what it costs or when they can see it
comes from the live feeds and the sheet, never from an agent's assumption. If a
fact is not in the sheet, the config or the data, leave it out and ask.

---

## 9. Verifying

There is no build. Serve the folder and look:

```bash
python3 -m http.server 8777
```

Check the page renders, the booking widget shows a live calendar, the
availability card appears, and the console is clean.

After a deploy, GitHub Pages and its CDN will serve the old page for a while. A
normal reload is not proof. Verify with a cache-busting query:

```bash
curl -s "https://broadlineliving.com/<page>.html?x=1" | grep "<what you changed>"
```

---

## 10. Boundaries

- The **Revenue Engine** is a separate deployment, a single HTML file on
  Netlify. Never cross the two.
- The **applications app** is a separate Railway app with its own database. The
  only link is `applicationPropertyId`.
- Rates reach this site only by the Revenue Engine publishing to Supabase.
  Nothing in this repo computes a rate.

If a change would touch any of those, stop and ask rather than reaching across.
