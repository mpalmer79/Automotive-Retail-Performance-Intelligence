# `UX.2D` — operating-experience closeout, reviewed

What the increment produced, measured with the same harness and under the same conditions as
[`UX-2D-BASELINE.md`](UX-2D-BASELINE.md): a production build (`next build`, `next start -p 3311`),
Chromium, 390 × 844 and 1440 × 900 as the reported viewports and the console's full eight-width
matrix for the responsive assertions. The before-column of every table below is that document.

Starting `main`: `9c109b677725c629d6e041521a40e4c2334679c5` — the merge of `UX.2C` (PR #65). CI and
Frontend were green on the preceding commit and were still running on the merge commit when the
branch was cut; both were confirmed terminal and green before the pull request left draft.

---

## 1. The headline

**The shared control band was consuming 65% to 109% of a phone screen on eight operating routes. It
now consumes 24% to 52%, and the first data visualization on every one of them moved up by between
326 and 482 pixels.**

| Measure                                          |     Before |      After | Change             |
| ------------------------------------------------ | ---------: | ---------: | ------------------ |
| Control band at 390, tallest route (Inventory)    |     921 px |     439 px | **−52.3%**         |
| Control band at 390, range across eight routes    | 548–921 px | 201–439 px | —                  |
| Control band at 390, share of one screen, tallest |       109% |        52% | —                  |
| First visual at 390, Inventory                    |     997 px |     515 px | **−48.3%**         |
| First visual at 390, worst route                  |     997 px |     515 px | —                  |
| Routes offering filter removal and reset          |     1 of 9 |     9 of 9 | —                  |
| Routes naming the store rather than its code      |     4 of 9 |     9 of 9 | —                  |
| Control band at 1440, range                       | 230–494 px | 200–486 px | unchanged by intent |
| Client islands on any operating route             |          1 |          1 | unchanged          |
| Client JavaScript added by this increment         |          — |    0 bytes | —                  |
| New dependencies                                  |          — |          0 | —                  |

## 2. Geometry, before and after

| Route                        | Band 390 |     After |      Δ | 1st visual 390 | After | Height 390 |  After | Band 1440 | After |
| ---------------------------- | -------: | --------: | -----: | -------------: | ----: | ---------: | -----: | --------: | ----: |
| `/`                          |      548 |   **222** | −326   |            624 |   298 |      9,066 |  8,739 |       230 |   200 |
| `/dashboard/sales-gross`     |      565 |   **222** | −343   |            641 |   298 |      7,139 |  6,797 |       254 |   254 |
| `/dashboard/deals`           |      631 |   **201** | −430   |              — |     — |      9,326 |  8,896 |       355 |   355 |
| `/dashboard/deals/[saleId]`  |      322 |       322 |      — |            398 |   398 |      8,250 |  8,250 |       267 |   267 |
| `/dashboard/inventory`       |  **921** |   **439** | **−482** |          997 |   515 |      3,892 |  3,409 |       494 |   486 |
| `/dashboard/fi`              |      753 |   **392** | −361   |            829 |   468 |      5,999 |  5,638 |       369 |   365 |
| `/dashboard/leads-marketing` |      721 |   **328** | −393   |            797 |   404 |      7,187 |  6,795 |       373 |   373 |
| `/dashboard/employees`       |      711 |   **293** | −418   |            787 |   369 |      6,311 |  5,893 |       431 |   427 |
| `/dashboard/accounting`      |      718 |   **282** | −436   |            794 |   358 |      4,228 |  3,792 |       428 |   424 |
| `/dashboard/actions`         |      245 |       245 |      — |            321 |   321 |     17,243 | 17,243 |       234 |   234 |
| `/technical`                 |      663 |       663 |      — |              — |     — |     10,088 | 10,088 |       502 |   502 |
| `/about`                     |    1,091 |     1,091 |      — |              — |     — |     11,483 | 11,483 |       691 |   691 |

**`/dashboard/actions` and the Deal Jacket are unchanged because they render no shared filter
form**, which is exactly why the baseline named them as the two routes that were already right.
`/technical` and `/about` are unchanged because they are not operating routes and `UX.2D` §46–§47
ask for shell consistency rather than a redesign; both already wear the site shell.

**The desktop band moved by at most 30 px, and that is the intended result.** `UX.2D` §7's job on
desktop was to stop the band drifting, not to shrink it. The 8 px changes on Inventory, F&I,
Employees and Accounting are the removed spacing between the chip row and the form; the 30 px on the
Executive surface is the deleted "None. Showing the group over the latest full month" line.

**Visible prose fell on eight routes and rose on none.**

| Route                        | `proseRepo` before | After | Change |
| ---------------------------- | -----------------: | ----: | -----: |
| `/`                          |                601 |   598 |     −3 |
| `/dashboard/sales-gross`     |                634 |   607 |    −27 |
| `/dashboard/deals`           |                147 |   126 |    −21 |
| `/dashboard/inventory`       |                306 |   297 |     −9 |
| `/dashboard/fi`              |                418 |   390 |    −28 |
| `/dashboard/leads-marketing` |                546 |   512 |    −34 |
| `/dashboard/employees`       |                249 |   214 |    −35 |
| `/dashboard/accounting`      |                425 |   388 |    −37 |

The reduction is one deletion repeated: the per-chip explanatory note for a `partial` parameter,
which said in a sentence what the chip now says in one word and which the control's own hint says in
full. `not-applicable` chips keep their sentence, because a parameter that is in the URL and doing
nothing is the case where a reader can be actively misled. No caveat was removed from any route.

## 3. Route cost

Total bytes, uncompressed, cold load, 1440 × 900, same harness at both ends.

| Route                        | HTML before | After | Total before |    After |        Δ |
| ---------------------------- | ----------: | ----: | -----------: | -------: | -------: |
| `/`                          |       615.3 | 616.8 |      1,563.3 |  1,571.3 |  +8.0 kB |
| `/dashboard/sales-gross`     |       337.9 | 340.2 |      1,291.2 |  1,289.0 |  −2.2 kB |
| `/dashboard/deals`           |       326.7 | 328.8 |      1,274.7 |  1,276.8 |  +2.1 kB |
| `/dashboard/deals/[saleId]`  |       218.0 | 218.0 |      1,159.5 |  1,160.1 |  +0.6 kB |
| `/dashboard/inventory`       |       781.8 | 784.1 |      1,734.8 |  1,732.7 |  −2.1 kB |
| `/dashboard/fi`              |       253.5 | 257.3 |      1,206.8 |  1,210.9 |  +4.2 kB |
| `/dashboard/leads-marketing` |       442.1 | 444.2 |      1,395.1 |  1,392.2 |  −2.9 kB |
| `/dashboard/employees`       |       248.0 | 250.0 |      1,196.0 |  1,198.0 |  +2.0 kB |
| `/dashboard/accounting`      |       158.0 | 160.2 |      1,106.3 |  1,113.5 |  +7.2 kB |
| `/dashboard/actions`         |       663.1 | 663.1 |      1,626.7 |  1,616.8 |  −9.8 kB |
| `/technical`                 |       239.9 | 239.9 |      3,737.4 |  3,737.2 |  −0.1 kB |
| `/about`                     |       200.4 | 200.4 |      1,391.9 |  1,396.8 |  +4.9 kB |

**HTML rises by 1.5 kB to 3.8 kB on the eight routes that gained a disclosure and 250 chip and
reset links**, and the total moves by less than that in both directions because the measurement
includes fonts and images whose cold-load timing varies between runs. **JavaScript is identical on
every route, to the byte.** The largest route is still `/technical` at 3,737 kB, driven by its
motion and diagram modules; the largest HTML route is still `/dashboard/inventory` at 784 kB,
driven by its 250-unit disclosure. Neither is the control band, before or after.

`/about` moving +4.9 kB with no source change is run-to-run variance in the same measurement, and
is recorded rather than explained away.

---

## 4. The thirty-four questions (`UX.2D` §89)

**1. Starting SHA?** `9c109b677725c629d6e041521a40e4c2334679c5`.

**2. Main workflow state?** CI and Frontend green on `93a302dc` and on every preceding merge in the
window; the post-merge run on `9c109b67` itself was in progress when the branch was cut and was
confirmed terminal and green before the pull request left draft.

**3. Control-band height before/after at 390?** 548–921 px before, 201–439 px after. Per route in
§2. Inventory, the worst case, fell 482 px.

**4. Executive control height before/after?** Band 548 → 222 px at 390; 230 → 200 px at 1440. The
shared filter form alone was 298 px at 390 and is now inside a collapsed disclosure.

**5. Inventory first visual before/after on mobile?** 997 → 515 px.

**6. F&I first visual before/after?** 829 → 468 px at 390; 385 → 381 px at 1440.

**7. Leads first visual before/after?** 797 → 404 px at 390; 389 px unchanged at 1440.

**8. Employees first visual before/after?** 787 → 369 px at 390; 447 → 443 px at 1440.

**9. Accounting first visual before/after?** 794 → 358 px at 390; 444 → 440 px at 1440.

**10. Actions first prompt before/after?** 321 px, unchanged at both widths. Actions renders no
shared filter form and was already the best-performing route in the baseline; `UX.2C` had just
rebuilt it and `UX.2D` §43 asks for a re-test rather than a change. Re-tested: the queue summary,
the facets and the first prompt are all inside the first two mobile screens.

**11. What filter-persistence defects were found?** Six, all in the baseline's friction register.
Executive → Inventory, → Accounting (twice) and → Actions were bare pathnames dropping a store the
destination declares `applied`. All 250 Inventory unit links dropped the lot they were clicked
from. Employees role and employee links, and Deal Explorer sort and pager links, propagated
`compare` — a parameter both routes declare `not-applicable`.

**12. What were fixed?** All six. Every in-content operating link now goes through `operatingHref`,
which reduces the context to the destination's own support matrix before serializing it. A route's
private parameter — `role` on Employees — is appended through one helper, `withRouteParam`, which
encodes its value and drops an empty one. `tests/unit/ux2d-consistency.test.ts` asserts the whole
persistence matrix, and `tests/e2e/ux2d-controls.spec.ts` asserts it through a real browser
navigation.

**13. What methodology duplication was removed?** Two things, both duplicates rather than caveats.
The Executive band's "Active filters — None. Showing the group over the latest full month, against
the prior month.", which restated the scope line four elements above it. And the per-chip
explanatory note for a `partial` parameter, which restated the control hint sitting beside it. The
note for a `not-applicable` parameter stays, and every route caveat `UX.1` ruled must be visible is
still visible and still outside the disclosure.

**14. What visual primitives were consolidated?** Two components became one:
`ActiveFilters` (Executive: removable chips, reset, per-chip notes) and `ActiveFilterChips` (the
other eight routes: the same information, inert) are now `ActiveFilterSummary`. Nothing else was
consolidated.

**15. What was intentionally kept separate?** Everything else. `UX.2D` §24's rule — consolidate only
where two components share a data contract, a visual grammar, an absence behaviour, an accessibility
behaviour and a semantic colour behaviour — excludes the pairs that look similar and are not:
`storeMarkClass` and `roleMarkClass` both map an identifier to one of three categorical hues and
mean different things; `StoreComparisonBars` and the composition bars both draw width and one is
signed; Accounting's subledger/GL pair uses the same two palette steps as the store series on a
route where no store series appears. No `GenericChart` was created.

**16. Store colour stable?** Yes, and it already was. `storeMarkClass` derives the mark from the
business code rather than from the row's position, so a store filtered out of scope does not shift
another store's hue. This was verified rather than changed; the baseline records it as clean.

**17. Domain colours stable?** Yes. The `zone-*` tokens are domain identity, carry no state and are
drawn from a different tier than the `data-*` tokens, which is what stops a tint being read as a
value. Unchanged by this increment.

**18. Accounting signs neutral?** Yes. Variance keeps its signed presentation with no favourable
direction, and the missing-side states stay distinct from zero. Unchanged.

**19. Employee fairness preserved?** Yes. The role switch stays OUTSIDE the control disclosure —
four role families are four views of the route, not four filter values — so a phone reader can see
which view they are on and move between them without opening anything. Ordering is still store and
identifier, the sample floor still withholds, and no rank, score or percentile exists.

**20. Action severity preserved?** Yes. `/dashboard/actions` is unchanged by this increment apart
from its scope line, which now names Granite Subaru rather than `GSA-002`.

**21. Mobile navigation result?** Unchanged and re-tested. The drawer opens by keyboard, closes
predictably, marks the current route, carries the analytical scope on its links and works with
scripting disabled — the existing `navigation.spec.ts` contract, which passed unmodified.

**22. No-JS result?** Clean, and the control architecture was designed for it: the responsive
disclosure is CSS, not JavaScript. With scripting disabled a phone reader taps the summary, gets the
native GET form and submits it; a desktop reader gets the controls with nothing to open; chip
removal and reset are links. All asserted in `ux2d-controls.spec.ts` under `javaScriptEnabled:
false`.

**23. Axe result?** Clean. The full accessibility sweep — twelve public routes plus the drill-through
and the seven non-default technical views — passes with no serious or critical violation and no
suppressed rule.

**24. 200% zoom result?** Clean. 200% at 1280 presents as a 640 px layout viewport, which is below
the 48rem breakpoint: the reader gets the phone disclosure, the summary is a full touch target, the
form opens, and nothing overflows sideways. Asserted.

**25. Reduced-motion result?** Clean and unchanged. `<details>` has no animation; the chevron's
rotation is a CSS transition and the site-wide reduced-motion block already floors every transition
to 1 ms.

**26. Print result?** Unchanged and correct by construction. The print block already opens every
`<details>` through `::details-content`; the control disclosure is a `<details>`, so a printed
operating page carries the controls exactly as it carried every other disclosure.

**27. Route-cost changes?** In §3. HTML +1.5 to +3.8 kB on the eight routes that gained a disclosure
and their chip links; JavaScript identical to the byte on every route.

**28. Client-island changes?** None. One island on the operating routes before (`FilterBar`) and one
after. `UX.2D` added no `'use client'` module.

**29. Any new dependencies?** None.

**30. Any new data objects?** None. No KPI, no warehouse fact, no dimension, no reporting view, no
export dataset. `scripts/generate-dashboard-data.ts --check` reports the generated tree
byte-identical.

**31. Any Power BI changes?** None.

**32. Persona tour results?** Seven tours, in the baseline's friction register. Every P1 and every P2
it recorded is fixed. The three journeys that were materially broken — a general manager losing the
store on the way to Inventory, a used-vehicle manager losing the lot on the way to a unit, an F&I
director unable to reach a desk's people context at all — now complete without retyping anything.

**33. Remaining product gaps?** Four, recorded rather than solved:

- **Leads & Marketing still has no outbound drill-through.** Every candidate destination would need
  a lead-source or campaign dimension the destination's datasets do not carry — `/dashboard/deals`
  declares `source` applied and is the one possibility, but a link from a funnel figure to a deal
  index asserts a lead-to-deal attribution the export does not publish at that grain.
- **`/dashboard/actions` accepts no period.** It is a queue evaluated at the export's as-of date, and
  the support matrix says so. A manager who wants "what needed review in November" cannot ask.
- **`/dashboard/inventory` accepts `period` only as `partial`**, because a snapshot route resolves a
  period to the last snapshot inside it. That is correct and is a data property, not a UI one.
- **The Deal Jacket has no next/previous within the filtered deal set.** A reader who drills into one
  of 106 deals returns to the index rather than stepping through it.

**34. Is ARPI ready for `DASH.13`?** Yes. §7 below is the handoff.

---

## 5. What was built

### 5.1 One control band (`UX.2D` §6–§8)

`src/components/dashboard/operating-controls.tsx`, rendered by `OperatingPageHeader` for all nine
routes. Three tiers in reading order: the scope line, always visible; the active-filter summary,
always visible and absent when nothing is set; and the controls, inside a native `<details>`.

The responsive part is two CSS rules in `globals.css`, guarded by `@supports selector(::details-content)`:
above 48rem the summary is hidden and the disclosure's content is forced visible. **There is no
client component, no state, no effect and no viewport measurement in JavaScript.** The technique is
the one this site already uses to open every disclosure for print, and the guard is what makes the
fallback on an engine without the pseudo-element "one click to the controls" rather than "no
controls".

Route-specific control forms moved inside with the filter form: the Deal Explorer's search, the
Inventory search and ordering. Route caveats, banners, notices and the Employees role switch stayed
outside, for the reasons the component's own file comment states.

### 5.2 One analytical-scope vocabulary (`UX.2D` §9)

`src/lib/dashboard/scope.ts`. Five routes printed `GSA-002` and four spelled the whole group four
ways, including F&I's lowercase `the group`. One helper now, called by the four selectors that build
a scope label and by the five routes that built one inline.

### 5.3 One active-filter summary (`UX.2D` §2)

Removal and reset on all nine routes. A chip removes **exactly its own parameter** and leaves the
rest, including one the route declares `not-applicable` — predictable beats tidy, and the
`not-applicable` chip exists precisely so a reader can remove that parameter deliberately.

### 5.4 One link builder (`UX.2D` §10–§12)

Every in-content operating link goes through `operatingHref`. `withRouteParam` is new and appends a
route's private parameter, encoded, in one place.

### 5.5 One catalogue address (`UX.2D` §35)

`kpiCatalogueHref` in `src/lib/technical.ts`. Three modules built `/kpis#KPI-…` by hand — the
catalogue's pre-`UX.1` address, which still resolves through a permanent redirect. Every KPI
identifier on the console now links to `/technical?view=kpis#…` directly.

### 5.6 One new drill-through (`UX.2D` §35, §77)

F&I's manager table links each finance desk to its people context on `/dashboard/employees`, which
declares `employee` applied. The unstaffed group gets no link. The pair had been one-way since
`DASH.11`. No ordering, denominator or sample rule changed.

### 5.7 Removed

`ActiveFilters` (`context-rail.tsx`) and `ActiveFilterChips` (`operating-page-header.tsx`), both
superseded and both proven unused before deletion.

---

## 6. Quality, as run

| Gate                                                       | Result                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| `uv run ruff format --check .`                              | 199 files already formatted                                   |
| `uv run ruff check .`                                       | all checks passed                                             |
| `uv run mypy src tests`                                     | clean, after `uv sync --frozen --all-extras`                  |
| `uv run pytest -q -m "not integration" --cov=arpi`          | **3,667 passed**, 1,229 deselected, **coverage 88.94%**        |
| `scripts/check_naming.py`                                   | no retired identifier used as a current identity              |
| `scripts/check_docs_links.py`                               | every relative link and anchor resolves                       |
| `scripts/check_reference_data.py`                           | every rule passed                                             |
| `scripts/check_secrets.py`                                  | no high-signal secret pattern                                 |
| `scripts/check_powerbi_model.py`                            | the semantic model matches its documentation                  |
| `scripts/simulate_semantic_model.py --check`                | 1,271 checks, 49/49 measures simulated, 11 contexts, 0 findings |
| `scripts/check_simulation_labels.py`                        | labelling check passed                                        |
| `scripts/check_project_capabilities.py`                     | declared status, documentation and the website agree           |
| `scripts/generate_project_capabilities.py --check`          | every generated block current                                 |
| `npm run format:check`, `lint`, `typecheck`                 | clean                                                         |
| `npm run manifest:check`, `inventory:check`, `dashboard:check` | 541 inventory records, **38 datasets / 312 files / 7,356,934 bytes — byte-identical** |
| `npx vitest run`                                            | **1,492 passed** across 37 files (37 new in `ux2d-consistency.test.ts`) |
| `next build`                                                | compiled, 22 routes                                           |
| `npx playwright test --project=chromium`                    | **958 passed** (55 new in `ux2d-controls.spec.ts`)             |

**Integration tests were not run locally**: this environment has no populated PostgreSQL, and no
data, SQL or loader file changed. CI runs the canonical integration lane, and it passed.

**Seven existing browser assertions were changed, and every one for a stated reason.** Six named the
old scope vocabulary; one asserted the Executive band's duplicate "None. Showing the group"
sentence that this increment deleted; one asserted the per-chip note for a `partial` parameter; one
asserted the KPI catalogue's pre-`UX.1` address. An eighth moved its negative from the whole of
`<main>` to the scope line, because "All three stores" is also the store control's default option —
a page-wide negative would have been asserting that the control was missing rather than that the
scope was narrowed.

---

## 7. `DASH.13` handoff

`UX.2D` leaves a stable product. What `DASH.13` inherits, and what it still has to do:

| Category                        | State at the end of `UX.2D`                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Route × viewport sweep          | Measured for this increment across eight widths; `DASH.13-01` should sweep the whole matrix now that the surfaces have stopped moving.     |
| Payload budgets                 | Every route cost measured here, before and after. `DASH.13-02` can set budgets from a stable base for the first time.                      |
| Broken-link sweep               | One stale internal link found and fixed (`/kpis`). A full sweep, including external links, is `DASH.13`'s.                                 |
| Accessibility release gate      | Axe clean, keyboard verified, 200% verified, no-JS verified. The release gate itself is `DASH.13`'s.                                       |
| Production metadata, canonicals | Untouched by `UX.2D`.                                                                                                                      |
| Runtime error sweep             | Untouched.                                                                                                                                 |
| Fresh database reproduction     | Untouched; no data changed.                                                                                                                |
| Power BI status truth           | Unchanged and externally pending.                                                                                                          |
| Release tag                     | `DASH.13`'s decision.                                                                                                                      |
| Project-capability reconciliation | `check_project_capabilities.py` and `generate_project_capabilities.py --check` pass at the head of this branch.                            |

Four product gaps are recorded in question 33 above. None of them is a defect in what was built;
each is a place where the data does not yet support a journey a persona attempted.

---

Power BI real-engine validation remains externally pending; `UX.2D` does not alter that state.
