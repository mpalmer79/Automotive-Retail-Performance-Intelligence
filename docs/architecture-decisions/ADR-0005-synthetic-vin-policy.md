# ADR-0005: Synthetic VIN Policy

## Status

**Accepted**

## Date

2026-07-28

## Deciders

Michael Palmer

## Context

`warehouse.dim_vehicle` needs a stable, unique, human-recognisable identifier for each physical vehicle.
The real-world equivalent is the Vehicle Identification Number, and every dealership system a reviewer has
worked with keys on it. A model that omitted the concept entirely would look wrong to anyone who knows the
domain.

But a VIN is not an inert string. In the real world it is a lookup key into vehicle history, title, lien,
recall, and — through registration and service records — owner data. `ARCHITECTURE.md` §35.2 lists
"Changing the synthetic VIN policy" among the decisions that require an ADR, which presupposes a recorded
policy to change. Until now no such record existed: the constraints were scattered across
`ARCHITECTURE.md` §16.2, `PRIVACY_AND_ETHICS.md`, and the acceptance criteria of `P1.1-02`, with no single
document a reviewer could read to find out what the rule actually is.

Three forces had to be balanced.

**Recognisability.** The identifier should read as a VIN to a domain reader, or the model loses the
demonstration value of having modelled vehicles at all.

**Non-collision with reality.** A 17-character string drawn from the real VIN alphabet, generated in
volume, will eventually collide with a VIN that exists on a real vehicle. A colliding identifier in a
public repository is an identifier that can be pasted into a decoder or a history service and returned as a
real car. That is a privacy and integrity problem the project should not create, and it is not mitigated by
the string being synthetic in origin — nobody downstream can tell.

**Non-derivation.** The generator must be provably unable to have copied a real VIN, which means holding no
real-VIN reference data and making no network call. `ARCHITECTURE.md` §16.1 permits NHTSA vPIC as an
approved enrichment source, and vPIC is a VIN decoder — so the boundary between "we model vehicles" and "we
look vehicles up" has to be drawn explicitly rather than left to the default value of a feature flag.

## Decision

**The identifier is a 17-character synthetic string with a fixed `ARPI` prefix. It is deliberately not a
structurally valid real VIN, it is derived from no real VIN data, and it expresses no owner relationship.**

### Format

| Property | Value |
|---|---|
| Column | `warehouse.dim_vehicle.synthetic_vin`, `char(17)`, `NOT NULL`, `UNIQUE` |
| Length | 17 characters, matching real VIN length |
| Positions 1–4 | The literal `ARPI` |
| Positions 5–17 | 13 characters drawn from `ABCDEFGHJKLMNPRSTUVWXYZ0123456789` |
| Alphabet exclusions | `I`, `O`, and `Q` are excluded, as in the real VIN alphabet, so the string cannot be misread |
| Generation | Deterministic from the vehicle entity's seed namespace; identical inputs produce an identical value |
| Uniqueness | Enforced by a unique index on the column, and asserted by a registered check |

The column is named `synthetic_vin`, not `vin`. The name carries the disclosure into every query, every
view definition, and every error message, so a reader who never opens the documentation still cannot mistake
it for a real one.

### Why it is deliberately not a structurally valid VIN

A real VIN encodes a world manufacturer identifier in positions 1–3, a check digit in position 9 computed
by a published weighted-transliteration algorithm, and a model-year code in position 10. A string that
satisfied all three would be indistinguishable from a real VIN by any automated check, which is precisely
the property to avoid.

`ARPI` is not an assigned world manufacturer identifier, and the remaining 13 characters are generated
without regard to the check-digit algorithm, so the value will not validate. **This is the intended
outcome, not a limitation.** A VIN validator rejecting an ARPI identifier is the control working: it means
the value cannot be mistaken for, or resolved as, a real vehicle by any downstream consumer.

Two properties follow, and both are load-bearing:

1. **No collision with a real vehicle is possible**, because the namespace is disjoint by construction
   rather than by luck. This does not depend on volume, on the seed, or on how many vehicles are generated.
2. **The disclosure is in the data itself.** A row exported to CSV, screenshotted into a portfolio page, or
   pasted into a spreadsheet carries `ARPI…` with it. Documentation can be separated from data; a prefix
   cannot.

### No real VIN data and no lookup

- The repository contains **no real VIN data**, no VIN reference table, no decoded-VIN fixture, and no
  sample file of real identifiers.
- The generator makes **no network call**. `features.enable_public_vehicle_enrichment` remains `false`, and
  generation runs with no network access.
- **No VIN decoding occurs**, from NHTSA vPIC or any other service, in generation, ingestion, or reporting.
  vPIC remains an approved enrichment *category* under `ARCHITECTURE.md` §16.1, but it is not called, and
  turning it on would be a separate decision with its own record.
- Vehicle attributes — make, model, trim, body style, fuel type, drivetrain — come from the synthetic model
  catalogue built by `P1.1-01`. They are **not** decoded from the identifier, and the identifier encodes
  nothing about them. The string is an opaque key.

### No owner relationship

**`synthetic_vin` expresses no relationship to any person.** `dim_vehicle` carries no owner, no registrant,
no title-holder, no prior-owner count, and no owner-history attribute. Where a sale links a vehicle to a
customer, the link is through `warehouse.fact_vehicle_sale`, between two synthetic surrogate keys, and the
customer dimension it reaches is itself governed by the prohibited-field contract in `P1.1-06` — no name, no
address, no contact detail, geography no finer than county.

This matters because "VIN plus owner" is the exact shape of the real-world record that carries the privacy
risk. The model deliberately does not have that shape.

## Alternatives considered

**Generate structurally valid VINs with a correct check digit.** More realistic, and it would demonstrate
knowledge of the VIN specification. Rejected because a valid VIN is by definition indistinguishable from a
real one, so the project would be publishing strings that decode as, or collide with, real vehicles. The
demonstration value is not worth manufacturing that risk, and the knowledge can be demonstrated in prose —
as this record does — without emitting the artefact.

**Use a real VIN prefix (a genuine world manufacturer identifier) with random remaining characters.**
Realistic-looking, and it would make franchise alignment visible in the identifier. Rejected because it
attaches a real manufacturer's assigned identifier to fabricated vehicles, which is both a collision risk
and an implicit association with a company that has no connection to this project.

**Use a plainly non-VIN key such as `VEH-0001337` alone, with no VIN-shaped column at all.** Safest, and
`vehicle_id` already exists in exactly that form. Rejected because the VIN is the identifier a dealership
domain reader expects to see, and its absence would read as a gap in the model rather than as a control.
The chosen policy keeps both: `vehicle_id` as the business key and `synthetic_vin` as the domain-recognisable
one.

**Hash a real VIN into a pseudonymous token.** Rejected outright: it requires possessing real VINs, which is
the thing the policy exists to prevent. A hash is also a derivation, so the "provably not derived from real
data" property would be lost.

**Use a UUID.** Unambiguously synthetic and collision-free. Rejected because it is 36 characters, looks
nothing like a vehicle identifier, and would make the dimension read as a generic table rather than a
vehicle one. `ARPI`-prefixed 17 characters achieves the same safety with the domain shape retained.

## Consequences

### Positive

- No generated identifier can collide with, decode to, or be resolved as a real vehicle. The property holds
  by construction and does not degrade with volume.
- The disclosure travels with the data. A screenshot, an exported CSV, or a Power BI visual carries `ARPI…`
  without needing an accompanying caption.
- The generator is provably offline and reference-data-free, which keeps the whole dataset reproducible from
  a seed and keeps `docs/research.md`'s licensing concerns about third-party vehicle data entirely out of
  scope.
- The column name `synthetic_vin` makes the nature of the value visible in SQL, in view definitions, and in
  the data dictionary.
- `ARCHITECTURE.md` §35.2's requirement now has something to point at: there is a recorded policy, so a
  future change to it is a superseding ADR rather than an undocumented drift.

### Negative

- The identifiers fail real VIN validation, so the project cannot demonstrate check-digit implementation or
  VIN decoding. That is a genuine skill it does not show, and it is stated here rather than glossed over.
- A reader who does not notice the `ARPI` prefix or the column name may briefly assume the values are
  realistic VINs. The prefix mitigates this but does not eliminate it.
- Model-year and manufacturer information is not recoverable from the identifier, so any future feature that
  wanted VIN-derived attributes would have to be built against the model catalogue instead.
- If NHTSA vPIC enrichment is ever enabled, this policy has to be revisited in the same change — decoding
  requires a decodable identifier, and the identifiers are deliberately not decodable. That is a real
  constraint on a documented future option, and it is the intended trade.
- Four of the seventeen characters are fixed, so the effective identifier space is smaller than a real VIN's.
  At the project's scale — a portfolio target of thousands of vehicles against 33^13 combinations — this is
  not a practical constraint, but it is a fact of the format.

## Enforcement

- A unique index on `warehouse.dim_vehicle.synthetic_vin`, with `DQ-VEH-001` registered as a critical
  uniqueness check.
- A generator test asserting the length, the `ARPI` prefix, and conformance to the restricted alphabet.
- A privacy test asserting that the repository contains no real-VIN reference data and that generation makes
  no network call.
- The acceptance criteria of `P1.1-02` in `docs/requirements/PHASE_1_BACKLOG.md`, which require the format,
  the uniqueness, and the absence of real-VIN reference data.

At the date of this record, `DQ-VEH-001` is defined in `src/arpi/validation/registry.py` as a critical
uniqueness check on `dim_vehicle.synthetic_vin`. The dimension, its unique index, and the generator do not
yet exist — `P1.1-02` and `P1.2-02` are `Planned`. This record states the policy those items must implement;
it does not claim they have.

## Relationship to other records

- `ARCHITECTURE.md` §16.2 sets the public-data controls this policy operates within, and §35.2 is what makes
  a change to it require a superseding ADR.
- `PRIVACY_AND_ETHICS.md` documents the policy for a reader who is not reading architecture records.
- **ADR-0002** decision 10 established the same principle for holidays: no external reference data, so the
  output is a pure function of the inputs. This record applies it to vehicle identifiers.
- `P1.1-02` in `docs/requirements/PHASE_1_BACKLOG.md` carries the acceptance criteria.
