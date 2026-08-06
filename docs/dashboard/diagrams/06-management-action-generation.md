# Dashboard Diagram 06 — Management-action generation

The deterministic path from rule file to rendered action, and the boundaries that keep it a review
queue rather than a fake workflow system.

```mermaid
flowchart TB
    RULES["config/dashboard/action_rules.yaml<br/>permanent rule ids · project-default thresholds"] --> ENGINE
    DATA["Exported datasets<br/>(allowlisted views only)"] --> ENGINE

    subgraph ENGINE["Export-time rule evaluation (deterministic)"]
        E1["Evaluate predicates over exported fields"]
        E2["Apply suppression<br/>(minimum sample, inactive entity)"]
        E3["Assign severity (first match wins)"]
        E4["Deduplicate on {rule, entity}"]
        E5["Render template explanation<br/>review verbs only, no causal claims"]
        E1 --> E2 --> E3 --> E4 --> E5
    end

    ENGINE --> DS["management-actions dataset<br/>action id · evidence · owner role · drill-through"]
    DS --> QUEUE["/dashboard/actions<br/>facets: domain, severity, store, owner role"]
    DS --> TOP["/dashboard top actions"]
    QUEUE --> DT["Drill-through:<br/>Deal Jacket · inventory unit · F&I · leads"]

    NOPERSIST["No write-back, no assignment,<br/>no completion, no history"]
    QUEUE -.boundary.-> NOPERSIST
```

**Determinism guarantee.** Same dataset version + same rule file → byte-identical queue. Every rule
has a firing fixture and a suppressed fixture in the test suite; a rule that has never fired in a
test is not shipped.
