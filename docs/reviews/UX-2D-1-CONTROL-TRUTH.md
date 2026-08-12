# `UX.2D.1` — five things the operating surface said that were not true

A follow-up to [`UX-2D-REVIEW.md`](UX-2D-REVIEW.md), in the same relationship `UX.2B.1` had to
`UX.2B`: the increment is merged and correct, and a second pass over the same surface found defects
its measurements were not shaped to see.

Starting `main`: `88d1179e87c6fb736945de63d90bbd4bfd9a5da8` — the merge of `UX.2D` (PR #66).
Measured from a production build (`next build`, `next start -p 3111`), Chromium, 390 × 844 and
1440 × 900.

---

## 1. Why a second pass found anything

`UX.2D` measured the control band and rebuilt it. Every number it set out to move, it moved: the
tallest phone band fell from 921 px to 439 px, the scope line went from four spellings to one, every
route gained chip removal and reset, and four broken drill-throughs were repaired.

**Every defect below survives that work, because none of them is a measurement.** Each one is
*correct-looking markup*:

* a filter control that renders perfectly and cannot change a figure;
* a price that renders as a different, smaller price;
* a rail that renders a true-looking sentence about a route it links to;
* a `<select>` that renders a real month which is not the month on screen.

A band can be compact and every one of these can still be wrong. Four were found by reading each
route's own declaration back against what it rendered; the fifth was found by eye.

---

## 2. The five

### 2a. Seven routes offered a control their own matrix declares inert

`filters.ts` declares, per route, what each of the thirteen URL parameters can honestly do there:
`applied`, `partial` or `not-applicable`. That declaration drives the active-filter summary and
`navigation.ts`'s cross-route link reduction. **It did not drive the controls.**

| Route | Rendered but declared `not-applicable` | Detail |
|---|---|---|
| `/dashboard/fi` | **Condition and Lead source** | Both with their **full option lists**, both operable. A reader could select `New`, submit, and watch every figure stay put. |
| `/dashboard/accounting` | **Condition and Lead source** | Empty option lists, two long "Not applied here…" notes. |
| `/dashboard/employees` | Condition | And `source`, declared **`partial`**, was passed an **empty option list** — so the one parameter this route says it applies could not be selected from the form. It was reachable only by typing it into the URL. |
| `/dashboard/leads-marketing` | Condition | |
| `/dashboard/inventory` | Lead source | |
| `/dashboard/sales-gross` | Lead source | |

`UX.2D` moved these controls inside a disclosure on a phone. That made the band compact and left the
controls inert — a reader now taps **Filters** to reach a Condition select on F&I that does nothing.

**The doctrine was already written**, in the `campaigns` prop of `filter-bar.tsx`, since `DASH.10`:

> A route that passes nothing gets no control rather than an inert one.

It had been applied to `campaign` and to nothing else. `<FilterBar>` takes `support` as a required
prop now and renders a control when, and only when, the declaration says the parameter means
something there **and** an option list exists for it. Visible interactive selects per route:

| Route | Before | After | Now offered |
|---|---:|---:|---|
| `/` | 5 | 5 | period, compare, store, condition, source |
| `/dashboard/sales-gross` | 5 | **4** | period, compare, store, condition |
| `/dashboard/deals` | 5 | **4** | period, store, condition, source — `compare` is declared `not-applicable` here and was being offered |
| `/dashboard/inventory` | 4 | **3** | period, store, condition |
| `/dashboard/fi` | 5 | **3** | period, compare, store |
| `/dashboard/leads-marketing` | 5 | **4** | period, store, source, campaign |
| `/dashboard/employees` | 4 | **3** | period, store, **source** — now with its catalogue |
| `/dashboard/accounting` | 4 | **2** | period, store |

The note that used to sit under an inert control is not lost. It lives in the support matrix, and
the active-filter summary `UX.2D` built already renders it when such a parameter arrives in the URL —
which is the only moment a reader needs it, and the moment a hint under a permanently-empty select
could never reach, because a filter carried in by the rail does not touch the destination's form.

### 2b. Money split mid-token, 35 times across five routes

`body` sets `overflow-wrap: anywhere`. That is correct and the reason is recorded beside it: this
site puts 68-character schema-qualified identifiers inside ordinary prose, and only `anywhere`
reduces min-content width enough to stop one forcing a 320 px viewport sideways. It is wrong for
money, because `anywhere` breaks a word at any character once the line is full.

| Route | Viewport | Broken money values |
|---|---|---:|
| `/dashboard/deals` | 1440 × 900 | **22** |
| `/dashboard/deals?store=GSA-002&condition=Used` | 1440 × 900 | 15 |
| `/dashboard/sales-gross` | 390 × 844 | 5 |
| `/?period=2025-12&store=GSA-002` | 390 × 844 | 4 |
| Deal Jacket, `/dashboard/accounting` | 390 × 844 | 2 each |
| `/`, `/dashboard/inventory` | 390 × 844 | 1 each |

In a 66 px price cell, `$38,127` renders as `$38,12` on one line and a lone `7` on the next. It is
not clipped and not ellipsised: it is silently rewritten into a different, smaller-looking number
that a reader skimming a column of figures has no reason to distrust.

`UX.2B.1` saw the symptom on the Deal Jacket — `AMOUNT FINANCED` as `$21,358.` above `02` — and
treated it with container queries, which fixed that panel's width without fixing the rule. The
`numeric` utility now sets `overflow-wrap: normal` and `word-break: normal`, under which UAX #14
treats a currency prefix, its digits and its group separators as one unbreakable run. **Now zero, at
390 and at 1440, across all ten routes.**

It cannot reintroduce page overflow: these are short tokens in table cells, and every wide table
already sits in a keyboard-reachable `overflow-x: auto` region, so a column needing more room widens
a table the reader can scroll rather than a page they cannot.

### 2c. The rail said a live route was not built

On every operating route, at every viewport, in both the desktop rail and the mobile drawer, the
served markup contained:

```
Not built yet
Actions · DASH.12
```

directly above a live `Actions` link to `/dashboard/actions` — a route `DASH.12` delivered, `UX.2C`
rebuilt and `UX.2D` restyled. `PLANNED_DASHBOARD_SECTIONS` in `site.ts` was correctly emptied by
`DASH.12`, and `site.test.ts` guards that list against outliving the work it describes. **Nothing
guarded the view, because the view was not reading the data** — the block was a hard-coded copy of
the list's last entry. It renders from the list now, and renders nothing while the list is empty.

The rail's docstring also still described "eight peer destinations". There are nine.

### 2d. Seven of eight period controls named a period the page was not showing

Absent `period` means "the latest full month the dataset holds" — a real member of `PeriodSelection`
that serializes to no parameter at all. A `<select>` whose value is `''` and whose options do not
contain `''` falls back to rendering its **first** option.

Only `/` offered the `Latest full month (default)` entry. The other seven had each rebuilt the option
list from `calendarMonths`, so they opened reading **`July 2025` above a page reporting December
2025**.

**This one was found by eye**, in a screenshot pass, on a build whose entire suite was green. A
control that names the wrong period is worse than one with no value: the reader has no reason to
distrust it. `FilterBar` renders the entry itself now, so no route can forget it and none can render
it twice.

### 2e. One methodology vocabulary

`components/dashboard/methodology.tsx` was exported by `UX.1` to be the console's one methodology
interaction and had **zero rendered usages**, ever — all 32 disclosure sites use
`components/ui/disclosure.tsx`, which already *was* the one pattern. The dead module is removed
rather than adopted: consolidating 32 call sites onto a near-identical component is the large
meaningless diff `UX.2D` §70 warns against.

The labels mixed a question form with a statement form, and two verbs for one act:

| Was | Is |
| --- | --- |
| `How is this calculated?` | `How this is measured` |
| `How every figure on this rail is calculated` | `How every figure on this rail is measured` |
| `How {metric} against plan is calculated` | `How {metric} against plan is measured` |
| `What can I put in the URL?` | `What the URL accepts` |
| `Which reporting views produced these figures?` | `Which reporting views produced these figures` |
| `What are the known limits of this data?` | `The known limits of this data` |

The distinction between "this metric" and "every figure on this rail" is kept, because it is a real
difference in what opening the disclosure gives you. The fifth row was reached only by the browser
test — it is built from a template and no static sweep found it.

---

## 3. What this increment did not touch

`UX.2D` is canonical and this is additive to it. **The control band architecture, the
`::details-content` disclosure, the scope-line vocabulary, `ActiveFilterSummary`, chip removal and
reset, the link-builder repairs and `withRouteParam` are all exactly as `UX.2D` shipped them.** No
module was added, removed or re-laid-out on any operating route. No visual primitive changed.

The one place this increment overlaps `UX.2D`'s surface is `FilterBar`, which gains a `support` prop
and a five-line predicate. The band gets shorter as a side effect — fewer controls — but no
measurement in `UX-2D-REVIEW.md` is invalidated: the disclosure is what made it compact, and the
disclosure is untouched.

---

## 4. Tests

`tests/e2e/ux2d1-control-truth.spec.ts`, 50 assertions, none of which duplicates
`ux2d-controls.spec.ts` or `ux2d-consistency.test.ts`:

| Contract | Asserted as |
|---|---|
| No inert control | No filter hint begins "Not applied", and no filter `<select>` has only its all-values option — on all nine routes |
| The period control is honest | Exactly one `option[value=""]`, selected, labelled `default` — on all nine, with Actions exempted **by name** so the exemption cannot be inherited by accident |
| Money is one token | Every `$…` run measured with a `Range` and required to occupy one line box, on ten routes at two viewports, excluding `.sr-only` |
| The rail does not contradict itself | No label the rail links to appears inside an "unbuilt" block |
| One vocabulary | No `main summary` matches the retired question or `calculated` forms |

One existing assertion in `dashboard-executive.test.tsx` was repointed at the settled verb, and both
retired phrasings are now asserted **absent** — the test is stronger than it was, not merely moved.

**The `.sr-only` exclusion in the money assertion is deliberate and is documented in the file.**
`globals.css` redefines `sr-only` to set `white-space: normal` precisely so a long visually-hidden
string cannot create phantom horizontal overflow — a real defect that once measured 523 px at a
375 px viewport. An accessible chart summary therefore wraps every few characters by design, inside a
box nobody sees; a screen reader is handed a string, and line boxes do not exist for it.

---

## 5. Gate results, as run

Against `732fbcb`, from a production build.

| Gate | Result |
|---|---|
| `uv run ruff format --check .` | 324 files already formatted |
| `uv run ruff check .` | all checks passed |
| `uv run mypy src tests` | no issues in 172 source files |
| `check_naming` · `check_docs_links` · `check_reference_data` · `check_secrets` | pass |
| `check_powerbi_model` · `simulate_semantic_model --check` · `check_simulation_labels` | pass, 1,271 checks, 0 findings |
| `check_project_capabilities` · `generate_project_capabilities --check` | pass |
| `npm run format:check` · `lint` · `typecheck` · `manifest:check` · `inventory:check` · `dashboard:check` | pass; 38 datasets, 312 files, 7,356,934 bytes — unchanged |
| `npx vitest run` | **1,492 passed** |
| `npx playwright test --project=chromium` | **1,008 passed, 0 failed** |

`pytest` was not re-run for this increment and no claim is made from it: **no Python file changed.**
The last full run on this branch's base recorded 3,667 passed at 88.94% coverage, and CI exercises the
canonical lane including the integration tests, which need a populated PostgreSQL this environment
does not have.

**Three existing browser assertions were repointed** and none weakened. `dashboard-fi.spec.ts`
asserted the reason an inapplicable filter is not applied by matching a hand-copied string from the
`conditionHint` this increment deletes; it imports `FI_SUPPORT` and asserts the matrix's own note now.
The two `dashboard.spec.ts` KPI-methodology assertions named the retired verb, and both retired
phrasings are now asserted **absent** — stronger than they were.

---

## 6. What this says about the program's method

Three of these five were reachable by reading a declaration the repository already contained and
comparing it against what shipped. The other two were reachable only by looking — one at a rendered
page, one at a rendered number.

`UX.2D` §100 says not to approve an increment merely because Playwright is green. It was green, for
`UX.2D` and again for this increment's first head, and the screenshot pass still found the period
control. That is the finding worth carrying into `DASH.13`: **"the suite is green" and "the product
is right" are different statements**, and the gap between them is where correct-looking markup lives.

---

## 7. Roadmap

`UX.2` remains **Implemented**; `UX.2D` remains **Implemented**. This increment changes no status: it
is a defect pass over merged work, recorded as `UX.2D.1` in the same way `UX.2B.1` recorded its own.

`DASH.13` remains **Planned** and is not begun.

---

Power BI real-engine validation remains externally pending; `UX.2D.1` does not alter that state.
