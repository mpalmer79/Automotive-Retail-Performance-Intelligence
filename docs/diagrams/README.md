# ARPI Diagrams

Source-controlled diagrams for **Automotive Retail Performance Intelligence (ARPI)**.

Every diagram in this directory is a Markdown file containing Mermaid in a fenced code block. There are no
binary images, no `.drawio` files, and no exported PNGs.

---

## The diagrams

| # | Diagram | What it answers |
|---|---|---|
| 01 | [System context](01-system-context.md) | What is the whole system, what exists today, and what is still planned? |
| 02 | [Phase 0 data flow](02-phase-0-data-flow.md) | What actually happens when you run the CLI — including audit capture and exit codes |
| 03 | [Initial dimensional model](03-initial-dimensional-model.md) | What tables exist, with what columns, and what facts they are designed to support |
| 04 | [Repository component map](04-repository-component-map.md) | Which directory owns what, and where does my change belong? |
| 05 | [Sanitized public inventory listing lane](05-inventory-listing-lane.md) | How does a public dealership listing become a governed warehouse row and an Excel report — and what must it never be allowed to claim? |

**Suggested order.** Read 01 for orientation, then 02 to see the implemented path in detail, then 03 for
the data model. Read 04 when you are about to change something. Read 05 only when you are working on the
second data lane; it is deliberately separate from 02, because the two lanes share a `sql/` tree and
nothing else.

---

## Why Mermaid in Markdown rather than binary images

This was a deliberate choice, and it holds even though Mermaid's layout control is weaker than a drawing
tool's.

**Diagrams are diffable.** A change to a Mermaid diagram shows up in review as changed lines with context.
A change to a PNG shows up as "binary file modified", which no reviewer can evaluate. Since these diagrams
document a system under active construction, they change often, and every change should be reviewable.

**Diagrams cannot silently go stale.** A binary image is regenerated from a source file that lives
somewhere else — a drawing tool's cloud document, or a `.drawio` file nobody has opened in months. The
source drifts from the export, and then both drift from the code. Here the source *is* the diagram. There
is nothing to fall out of sync with.

**No tool is required.** Contributing a diagram change needs a text editor. There is no licence, no
account, no install, and no "I can't open this file" for anyone reviewing the repository from a phone or a
terminal.

**They render where people read them.** GitHub renders Mermaid natively in Markdown, so the diagrams appear
inline in the browser without a build step, an image host, or a CI job that regenerates assets.

**Repository size stays small.** Text diagrams add kilobytes. Binary images add megabytes over a project's
life, because every revision is stored in full, forever.

**The trade-off.** Mermaid's automatic layout sometimes places nodes awkwardly, and fine visual control is
limited to what `classDef` and edge direction allow. That cost is worth paying for diagrams that stay true.
If a diagram ever genuinely needs pixel-level design — a portfolio hero image, for example — it belongs in
the portfolio packaging phase, not here.

---

## Previewing and editing

**On GitHub.** Open the `.md` file. Diagrams render automatically. Nothing else is needed.

**In VS Code.** Install the *Markdown Preview Mermaid Support* extension, then open the preview pane with
`Ctrl+Shift+V` (`Cmd+Shift+V` on macOS). The preview updates as you type.

**In a browser.** Paste the contents of a ```` ```mermaid ```` block into the
[Mermaid Live Editor](https://mermaid.live) for fast iteration on layout, then paste the result back.

There is nothing to regenerate. Editing the Markdown file *is* updating the diagram — no build step, no
export, no committed artifact to refresh.

---

## Conventions

Follow these when adding or editing a diagram, so the set stays coherent.

**Title.** Every diagram's H1 uses `ARPI` or the full project name — for example `# ARPI — System Context`.

**Implemented versus planned.** This is non-negotiable. Anything that does not exist yet must be marked
`(planned)` or `PLANNED` in its own label, drawn in the grey dashed style, and connected with dashed edges.
Never let a diagram imply that something exists. Encode status in *both* the label text and the styling, so
the diagram survives being read in greyscale or by someone who cannot distinguish the colours.

**Legend.** Every diagram carries a legend table explaining its shapes, colours, and line styles.

**Shared palette.** Keep the classes consistent across diagrams:

| Class | Fill | Stroke | Used for |
|---|---|---|---|
| `implemented` / `runtime` | `#dbeafe` | `#1d4ed8` | Implemented processes and code components |
| `store` / `artifact` | `#dcfce7` | `#15803d` | Databases, tables, and generated files |
| `decision` / `gate` | `#fef9c3` | `#a16207` | Branch points and quality gates |
| `planned` | `#f4f4f5` | `#a1a1aa`, dashed | Anything not yet built |
| `bad` | `#fee2e2` | `#b91c1c` | Failure paths |

**Filenames.** `NN-kebab-title.md`, numbered in reading order.

---

## Mermaid syntax notes

A few things break GitHub rendering silently. Check these before committing.

- **Quote every label.** Write `A["Label with (parentheses)"]`, not `A[Label with (parentheses)]`.
  Unquoted parentheses, braces, colons, and commas are parse errors or, worse, silently change the node
  shape.
- **`end` is reserved.** It terminates a `subgraph`. Never use `end` — in any casing — as a node id, and
  avoid a bare lowercase `end` inside a label.
- **Balance the fences.** Every ```` ```mermaid ```` needs a closing ```` ``` ````. An unbalanced fence
  swallows the rest of the document.
- **Line breaks in labels use `<br/>`**, not a newline.
- **`erDiagram` entity names cannot contain a dot.** Use `dim_date`, not `warehouse.dim_date`, and provide
  a mapping table beneath the diagram — diagram 03 does this.
- **`erDiagram` attribute types cannot contain parentheses.** Write `varchar` and put the length in the
  attribute comment, not `varchar(40)`.
- **`erDiagram` does not support `classDef`.** Mark planned entities in their attribute comments and
  relationship labels instead, as diagram 03 does.
- **Check it renders before committing.** Paste into the Mermaid Live Editor or open the VS Code preview. A
  broken diagram renders as a raw code block on GitHub, which is worse than no diagram.

---

## Related

- [`../index.md`](../index.md) — documentation hub and reading paths
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — the architecture these diagrams illustrate
- [`../architecture-decisions/`](../architecture-decisions/) — the decisions behind the design

*All data referenced in these diagrams is synthetic. Granite State Auto Group is fictional.*
