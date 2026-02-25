# Kata Classification — Bet and Stage Classification

> **Deferred to Wave D (issue #106).** This file is a placeholder.
>
> Classification is the process of analyzing a bet and recommending which kata pattern
> (stage sequence) and flavors best match the work. It will be implemented as an
> interactive `kata init` scanning step that reads existing code and produces
> classification recommendations.

---

## Planned Scope (Wave D, issue #106)

- Scan the project for tech-stack signals (languages, frameworks, test coverage)
- Match detected signals to available kata patterns and flavor libraries
- Produce a ranked recommendation: `{ pattern, flavors, confidence, reasoning }`
- Integrate into `kata init` as an optional post-setup step

Until Wave D ships, classification is manual: choose your kata pattern via `kata cycle add-bet --kata <name>` based on the bet's scope and the available patterns in `.kata/katas/`.
