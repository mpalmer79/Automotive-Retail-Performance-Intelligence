# Format Strings — ARPI Semantic Model

**Last reviewed:** 2026-07-29
**Parent:** [README.md](README.md)

The format string carried by every measure in the model, grouped by kind, with the rule each follows.

**Forty-eight of the forty-nine measures carry a format string.** The exception is `Pipeline Status`, which
returns text; see §9.

A format string is not decoration. It is the difference between `0.152` and `15.2%`, between `-1234` and
`($1,234)`, and between a number a reader can act on and one they have to interpret. It is also the last
place a modelling decision is visible before a number reaches a person, which is why the two deliberate
choices in §10 are recorded rather than left as taste.

**No format string here has been rendered.** Power BI Desktop has never opened this model. A format string
that the engine rejects fails at render time, not at parse time, so this document describes intent that has
not been observed. See [08-desktop-validation.md](08-desktop-validation.md).

---

## 1. The rules, in one table

| Kind | Format string | Measures | Rule |
|---|---|---:|---|
| Count | `#,0` | 17 | Thousands separator, no decimals. A count of cars or leads is a whole number. |
| Currency | `$#,0;($#,0);-` | 10 | Whole dollars, negatives in parentheses, zero as a dash. Three sections; see §3. |
| Percentage | `0.0%` | 9 | One decimal place. A rate is a rate, never a raw fraction. |
| Days, fractional | `0.0 "days"` | 2 | The unit travels with the number. |
| Days, whole | `0 "days"` | 3 | Whole days for a median and for days supply; see §6. |
| Minutes | `0.0 "min"` | 3 | Response and duration, in minutes, one decimal. |
| Multiple | `0.0"x"` | 1 | A return expressed as `3.4x`, never as a percentage. See §10.1. |
| Turns | `0.00` | 1 | Two decimals, no unit. See §7. |
| Unit-free magnitude | `#,0.00` | 1 | Two decimals, no currency symbol. See §8. |
| Timestamp | `yyyy-mm-dd hh:nn` | 1 | ISO-ordered date, 24-hour time, no seconds. |
| *(none)* | — | 1 | `Pipeline Status` returns a word. See §9. |

---

## 2. Counts — `#,0`

Seventeen measures. Every one is a count of discrete things and every one is an integer by construction.

| Measure | Group |
|---|---|
| Retail Units Sold | Sales |
| New Units Sold | Sales |
| Used Units Sold | Sales |
| Active Inventory Count | Inventory |
| Aged Inventory Count | Inventory |
| Leads Received | Lead Funnel |
| Unresponded Leads | Lead Funnel |
| Duplicate Leads | Lead Funnel |
| Sold Leads | Lead Funnel |
| Eligible Appointments | Lead Funnel |
| Shown Appointments | Lead Funnel |
| Advance Cancellations | Lead Funnel |
| Checks Passed | Data Quality |
| Checks Failed | Data Quality |
| Checks Skipped | Data Quality |
| Critical Reconciliations Failed | Data Quality |
| Rejected Rows | Data Quality |

The thousands separator matters at ARPI's volumes: `45754` and `45,754` are the same number, and only one of
them is read correctly at a glance on a card.

No count carries a decimal place, because half a car has never been sold. `Active Inventory Count` is
semi-additive and returns a closing position, which is still a whole number of vehicles.

---

## 3. Currency — `$#,0;($#,0);-`

Ten measures. The format string has **three sections**, separated by semicolons, and all three are
deliberate.

| Section | Applies to | Renders | Why |
|---|---|---|---|
| `$#,0` | Positive | `$12,450` | Whole dollars, thousands separated. |
| `($#,0)` | **Negative** | `($1,230)` | Parentheses, the accounting convention. |
| `-` | **Zero** | `-` | A dash, not `$0`. |

| Measure | Group |
|---|---|
| Front-End Gross | Gross |
| Back-End Gross | Gross |
| Total Gross | Gross |
| Front Gross per Retail Unit | Gross |
| Back Gross per Retail Unit | Gross |
| Total Gross per Retail Unit | Gross |
| Inventory Investment | Inventory |
| Aged Inventory Investment | Inventory |
| Cost per Lead | Marketing |
| Cost per Sale | Marketing |

**The negative section is the load-bearing one.** A negative front-end gross is a real and common thing in
automotive retail — a unit sold below cost to move aged inventory, a trade over-allowance, a mis-priced deal
— and [03-measure-groups.md §4](03-measure-groups.md) requires that negatives stay visible and be
distinguished by **more than colour alone**. Parentheses are that distinction. They survive a greyscale
print, a colour-blind reader, and a screenshot pasted into a document, none of which red text does.

**The zero section renders `-` rather than `$0`.** A dash reads as "nothing here"; `$0` reads as a measured
figure of zero. The two are different claims, and the rows where this matters are the ones a reader is most
likely to act on.

Note the interaction with `BLANK()`. A blank is not a zero and does not use the third section at all — a
blank cell renders empty. Every currency ratio here returns `BLANK()` on a zero denominator, so an
undefined figure is an empty cell, a genuinely zero figure is a dash, and a real number is a number. Three
states, three renderings.

---

## 4. Percentages — `0.0%`

Nine measures, one decimal place.

| Measure | Group |
|---|---|
| Aged Inventory Percentage | Inventory |
| Contact Rate | Lead Funnel |
| Appointment-Set Rate | Lead Funnel |
| Show Rate | Lead Funnel |
| Show-to-Sale Conversion | Lead Funnel |
| Lead-to-Sale Conversion | Lead Funnel |
| Cancellation Rate | Lead Funnel |
| Pass Rate | Data Quality |
| Evaluation Coverage | Data Quality |

The `%` in a format string multiplies by 100 as well as appending the sign, so the underlying `DIVIDE`
returns a fraction and the display is the percentage. Neither the measure nor the reporting view multiplies
by 100 anywhere; doing it in both places is the classic way a rate ends up as `1520.0%`.

**One decimal, not zero and not two.** Zero decimals collapses a 12.4 per cent contact rate and a 12.6 per
cent one onto the same card, which at ARPI's lead volumes is a real difference. Two decimals implies a
precision the data does not have: `12.44%` of 6,000 leads suggests the third significant figure means
something, and it does not.

Every percentage measure returns `BLANK()` on a zero denominator, so an undefined rate is an empty cell
rather than `0.0%`.

---

## 5. Minutes — `0.0 "min"`

Three measures: `Average Response Time`, `Median Response Time` and `Pipeline Duration`.

The unit is in the format string rather than in the measure name, so it appears beside the number on a card
where the field name may not be visible at all. `4.2 min` is self-describing; `4.2` under a card titled
"Response" is not.

Both response measures convert seconds to minutes at the **final measure boundary** — `... / 60` or
`DIVIDE(MEDIAN(...), 60)` — so the additive numerator stays in seconds and can never be summed in the wrong
unit. `Pipeline Duration` does the same with `duration_seconds`.

One decimal place. Response time is the measure most likely to be quoted in a finding, and the difference
between 4.2 and 4.7 minutes is the difference between two operational stories.

---

## 6. Days — `0.0 "days"` and `0 "days"`

Five measures, split across two format strings, and the split is deliberate.

| Measure | Format | Why |
|---|---|---|
| Average Inventory Age | `0.0 "days"` | A **mean** carries a fractional part legitimately: 47.3 days is what the arithmetic produced. |
| Days to Sale (Mean) | `0.0 "days"` | The same. |
| Median Inventory Age | `0 "days"` | A **median** of an integer column is a whole number or a midpoint of two integers. Showing `44.0 days` implies a precision the order statistic does not carry. |
| Days to Sale (Median) | `0 "days"` | The same. |
| Dealer Days Supply | `0 "days"` | A trailing-window estimate sensitive enough to seasonality that a decimal place would be false precision. |

**The rule: means get a decimal, medians and window estimates do not.** The two days-to-sale measures sit
beside each other by design ([03-measure-groups.md §5.2](03-measure-groups.md)), and the different formats
are a second signal — alongside the `(Median)` and `(Mean)` in their names — that they are different
statistics.

---

## 7. Turns — `0.00`

One measure: `Inventory Turn` (`KPI-INV-008`).

Two decimals and **no unit**. Inventory turn is expressed in turns per year, and there is no accepted short
unit token for it: `4.20 turns` is wordy on a card, `4.20t` is not a convention anybody reads. The measure
name carries the unit, and any visual using it should say "turns per year" in its title.

Two decimals rather than one because the interesting range is narrow. New-vehicle turn and used-vehicle turn
in the same store might be 3.8 and 4.1, and one decimal is enough — but the month-over-month movement that
signals a problem is often in the second decimal. The measure is also valid at month grain or coarser only,
so the number is rarer than most and can afford the precision.

---

## 8. Unit-free magnitude — `#,0.00`

One measure: `Reconciliation Difference`.

Two decimals, thousands separated, **no currency symbol and no unit**, and that absence is the point. Some
reconciliations compare row counts and others compare currency amounts, so the summed absolute difference has
no single unit. A `$` on this number would be a false statement on every row that reconciles a count.

It is a **magnitude to sort by**, not a total to read. Sorted descending it surfaces the worst offenders,
which is what it exists to do. Two decimals because a currency reconciliation that is off by four cents is a
different finding from one that is off by four dollars, and rounding would hide the smaller of the two.

---

## 9. Timestamp, and the one measure with no format string

`Last Successful Refresh` carries `yyyy-mm-dd hh:nn`: ISO-ordered date, 24-hour time, no seconds, no
timezone token. ISO ordering because `2026-07-29` sorts correctly as text and cannot be misread as a US or
European date; no seconds because refresh completion is not interesting to the second. It returns `BLANK()`
when no run has ever succeeded, which renders as an empty cell — the honest answer, rather than the
timestamp of a failed run.

**`Pipeline Status` carries no format string at all**, and this is the only measure in the model that does
not. It returns a word — `succeeded`, `failed`, `running` — and a format string on a text measure would be
meaningless. It is a text measure by design: the status *is* a word, and encoding it as a colour or a symbol
would put presentation logic inside the model. A report page is free to conditionally colour a card built on
it; the model states the fact and stops there.

---

## 10. Two deliberate notes

### 10.1 The multiple is written `0.0"x"`, not `0.0x`

`Gross Return on Advertising Spend` is formatted `0.0"x"`, with the `x` **inside double quotes**.

The quotes make the `x` a literal. Unquoted, `x` is not a recognised placeholder in the Power BI format
string grammar today, but the grammar is shared with VBA-style formatting, where single characters carry
meaning by position and new tokens have been added over time. A literal that is *currently* safe because it
is unreserved is a literal that stops being safe the day it becomes reserved, and the failure would be
silent: the number would render with a character replaced by something derived from the value.

Quoting removes the question. `"x"` is a literal by declaration rather than by luck, and the same convention
is used for `"days"` and `"min"` elsewhere in the model, so the rule is one rule rather than three cases.

The measure is a **multiple and never a percentage** — `3.4x`, not `340%`. Both are arithmetically the same
number and they are not the same statement: a percentage invites comparison against 100 per cent, which is
not a meaningful threshold for advertising return, while a multiple invites comparison against other
multiples, which is.

### 10.2 Currency-per-unit measures round to whole dollars

`Cost per Lead`, `Cost per Sale`, and the three per-retail-unit gross measures all use
`$#,0;($#,0);-` — the same whole-dollar format as the totals. **They do not show cents.**

`Cost per Lead` of `$47.83` renders as `$48`. That is intentional, and it is worth being explicit about the
trade-off because it is a real loss of information.

The reason is that the precision would be spurious. Marketing cost per lead depends on a first-touch,
single-source attribution rule; a monthly spend figure that is itself an allocation; and a lead count subject
to a duplicate-exclusion rule. Reporting the result to the cent implies a chain of precision that no link in
that chain supports. Whole dollars states the figure at roughly the accuracy it has.

The same argument applies to gross per retail unit: front gross excludes manufacturer incentives, holdback
and floorplan credits ([03-measure-groups.md §4](03-measure-groups.md)), so a figure carrying a systematic
understatement of hundreds of dollars should not be published to the cent.

**Where cents do matter, they are kept.** `Reconciliation Difference` uses two decimals precisely because a
reconciliation is a claim about exactness, and `RECON-GROSS-001` reconciles gross to the cent at row level
in SQL. The rounding is a display decision at the reporting boundary, not a loss of precision in the data.

---

## 11. No measure encodes colour, emoji or a status symbol

**No measure in this model returns a colour, a hex code, a colour name, an emoji, a Unicode symbol, an arrow,
a traffic light, or a status icon.** Not in a result, not in a format string, not in a description.

Every measure returns a number, a date, or — in exactly one case — a plain word. That is a rule about where
responsibility sits.

* **Presentation logic in a measure is invisible to a reconciliation.** A measure that returns `"🔴 3.2"`
  cannot be compared against a SQL baseline, so it falls outside every check in
  [09-sql-to-dax-reconciliation.md](09-sql-to-dax-reconciliation.md).
* **A threshold hidden in a measure is a threshold nobody reviewed.** "Red below 2.5x" is an editorial
  judgement about what counts as bad. Inside DAX it is undocumented, unversioned in any document, and
  invisible to a reader who sees only the colour.
* **Colour alone is not an accessible signal**, which is why negative currency uses parentheses (§3) rather
  than relying on red.

Conditional formatting on a visual is the right place for all of it: it is visible in the report definition,
it is a page-level decision, and it can be changed without touching a governed measure. That is `P2.2` work,
and no page exists yet.

---

## 12. What has not been checked

Every statement in this document describes a string in the TMDL. None of it has been rendered.

Specifically unverified: that the installed Power BI Desktop accepts `0.0"x"` and the three-section currency
string as written; that `0 "days"` rounds rather than truncates in the direction expected; that
`yyyy-mm-dd hh:nn` produces 24-hour time under the model's `en-US` culture; and that a `BLANK()` renders as
an empty cell rather than falling through to a format-string section. The gate that would establish all four
is [08-desktop-validation.md](08-desktop-validation.md), and its status is **PENDING**.
