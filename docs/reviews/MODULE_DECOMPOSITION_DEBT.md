# Module decomposition debt

`src/arpi/generation/employee.py` was decomposed into a package (see the pull request that
added this file). This records what was **not** decomposed, why, and what would justify
doing it.

It exists because "we should split this up one day" in a commit message is not a record.
A candidate list with reasons is reviewable; an intention is not.

## What was done, and what it cost

`employee.py` was 1,532 lines carrying eight responsibilities. It became eight modules,
the largest 540 lines, with no circular imports and the same forty-two names importable
from the same path.

The work was behaviour-preserving, and the evidence is
`tests/data_quality/test_employee_characterisation.py`: the generated CSV bytes, the
attribute hashes, the roster plan, the latent performance profiles and every validation
result are pinned by digest and unchanged. Those digests were recorded from the pre-split
module **before** any code moved, which is the only ordering that makes them evidence
rather than decoration.

Two defects were found by writing that suite rather than by the split itself:

- an assertion of mine reduced to `identifiers == identifiers`, making the whole
  row-order check vacuous;
- a claim in a module docstring that importing the column contract avoids pandas, which
  is false because `arpi.generation.__init__` eagerly imports every generator.

Both are corrected. The second is a real, separate limitation and is listed below.

## Remaining candidates

Ranked by responsibility density rather than line count. Line count is a symptom.

| Module | Lines | Responsibilities | Assessment |
| --- | ---: | --- | --- |
| `scripts/check_powerbi_model.py` | 1993 | TMDL parsing, model representation, ~9,452 assertions, evidence generation, reporting, CLI | **Strongest remaining candidate.** The parser and the assertions are genuinely separable, and the assertions are the part a reader needs. It has no unit tests of its own -- it is exercised only by running it -- so a split needs characterisation first, exactly as here. |
| `src/arpi/generation/lead.py` | 1725 | contract, distributions, funnel construction, activity generation, validation | Same shape as `employee.py` was, and the same split would apply. Higher risk: the lead funnel feeds appointments and sales, so a perturbed draw order moves three downstream facts, not one. |
| `src/arpi/generation/sale.py` | 1717 | contract, distributions, deal construction, gross calculation, validation | As above. Gross calculation is the most reviewable part and the hardest to find in the file. |
| `src/arpi/generation/marketing.py` | 1689 | contract, spend distributions, campaign construction, attribution, validation | As above. |
| `portfolio/scripts/generate-project-manifest.ts` | 1349 | source discovery, parsing, derivation, gate parsing, manifest emission | Deliberately untouched. The capability register compares against its output rather than replacing it, because two independent derivations of one fact catch drift that a single one cannot. Splitting it is worthwhile; folding it into the register is not. |
| `src/arpi/generation/acquisition.py` | 1118 | contract, distributions, construction, validation | Lower density than the four above. |

## Why only one Python module was decomposed here

The programme permitted up to two areas. One was taken, for three reasons:

1. **The characterisation suite is the expensive part, not the move.** Fifty-nine
   assertions were needed to make the `employee` split safe. A second module needs its own,
   and a split without them is a refactor whose correctness rests on nothing.
2. **The generators are coupled through their seeds.** `employee.py` was the safest first
   subject precisely because its output feeds others through a documented interface
   (`employee_performance_profiles`) rather than through shared draw order. `lead.py` and
   `sale.py` are not.
3. **`check_powerbi_model.py` has no tests at all.** Decomposing it means first giving it
   a test suite, which is a larger piece of work than the split and deserves its own
   review rather than being carried along inside one.

## A separate limitation this work surfaced

`arpi.generation.__init__` imports every generator eagerly, so importing any part of the
package — including a module that is nothing but string constants — pulls in pandas and
every other generator. That is why
`test_the_contract_module_declares_no_heavyweight_dependency` asserts the contract
module's *own* imports by parsing them, rather than watching `sys.modules` at runtime.

Making the package lazy would be a behaviour change, not a split, and belongs in its own
pull request with its own justification. It is worth doing: the CLI pays the full import
cost to run `--version`.

## What would justify taking the next one

Any of:

- a defect found in one of the modules above whose fix is hard to review because of where
  it sits;
- a second contributor working in the same file often enough for merge conflicts to cost
  real time;
- `check_powerbi_model.py` acquiring a test suite, which removes the main obstacle to
  splitting it.

Absent one of those, the remaining modules are large but coherent, and moving code for its
own sake risks the generated data for no benefit.
