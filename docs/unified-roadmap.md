# Unified Roadmap: Kataka + Meta-Learning Integration

> Merges the [Kataka Architecture](kataka-architecture.md) and [Meta-Learning Epic (#136)](https://github.com/cmbays/kata/issues/136) into a single sequenced implementation plan.
>
> See also: [Kata System Guide](kata-system-guide.md) for how the system works, [Design Rationale](v1-design-vision.md) for why, [Kataka Architecture](kataka-architecture.md) + [Sensei Orchestration](sensei-orchestration.md) + [Project Setup](project-setup.md) for the agent system.

---

## Context

Kata has completed Waves 0–E + K (2148 tests, 109 files). The core engine is built: orchestration, cooldown, TUI, CLI, skill package, and the Dojo personal training environment. Two major design efforts remain as the path to v1:

1. **Kataka Architecture** ([PR #154](https://github.com/cmbays/kata/pull/154) merged) — 5-phase agent wrapper system
2. **Meta-Learning Epic** ([#136](https://github.com/cmbays/kata/issues/136)) — 7-priority learning intelligence system

These two systems are deeply interdependent but were tracked separately with no unified sequencing. This roadmap merges them into a single implementation plan, identifies integration gaps, establishes blocking dependencies, and produces actionable issues.

**Current state**: No meta-learning or kataka code exists yet. The Dojo (Wave K) is shipped — diary entries, session generation, HTML output, source registry, CLI archive viewer. Wave F is fully groomed and ready for implementation. Epic #93 (kiai execution) has no child issues but most gaps are already resolved by existing infrastructure.

---

## Wave Sequence

### Wave F: "Foundations" — Shared Data Model

**Addresses**: P1 ([#137](https://github.com/cmbays/kata/issues/137)), P5 permanence fields ([#141](https://github.com/cmbays/kata/issues/141)), P7 hierarchy structure ([#143](https://github.com/cmbays/kata/issues/143)), [#144](https://github.com/cmbays/kata/issues/144) (themed vocab config), [#145](https://github.com/cmbays/kata/issues/145) (experience level), Kataka Phase 1 (lexicon + KATA.md)

> **Note**: [#153](https://github.com/cmbays/kata/issues/153) (`kata kime` alias) was already implemented — closed.

**What ships**:

**Domain types** (new fields required with defaults where possible; optional only for fields referencing systems not yet built):
- `ObservationSchema` — 7-type discriminated union (decision, prediction, friction, gap, outcome, assumption, insight). Every variant includes `katakaId?: string` for future agent attribution
- `LearningSchema` enrichment — `citations`, `derivedFrom`, `reinforcedBy`, `usageCount`, `lastUsedAt`, `versions`, `archived`, `permanence?`, `source?`, `overrides?`, `refreshBy?`, `expiresAt?`
- `LearningTier` extension — add `step` and `flavor` to existing `stage | category | agent`
- `ReflectionSchema` — discriminated union (calibration, validation, resolution, unmatched, synthesis)
- Graph index schema — `.kata/knowledge/graph-index.json` linking learnings to observations via citations

**Infrastructure**:
- `runPaths()` extension — add observation/reflection/resource JSONL paths at stage/flavor/step levels
- Observation writer utility — `appendObservation()` appending typed JSONL at any hierarchy level
- `LearningExtractor` update — consume observation JSONL alongside old `ExecutionHistoryEntry`

**CLI + Config**:
- `kata observe record` / `kata observe list` (alias: `kata kansatsu`) — agent-facing observation writer
- Lexicon extension — add `agent`, `artifact` (maki), `observation` (kansatsu) to both modes
- Config extension — `user.experienceLevel`, `cooldown.synthesisDepth` (note: `outputMode` already exists at config root — no new `display.vocabulary` needed)
- Experience level capture at `kata init`

**Context**:
- KATA.md generation at `kata init` — template with project metadata, active cycle, placeholder kataka registry, methodology preferences

**Scope**: ~8 schemas, ~3 CLI commands, ~120 tests. 2–3 sessions.

**Parallel agents** (3):
- A: All domain type schemas (tightly coupled)
- B: Lexicon + config + KATA.md generation + kime alias (CLI/config)
- C: Run tree extensions + observation writer + `kata observe` CLI (after A delivers schemas)

**Blocks**: Everything — this is the foundation.

---

### Wave G: "Practitioners" — Kataka Identity + Execution

**Addresses**: Kataka Phases 1–3, Epic [#93](https://github.com/cmbays/kata/issues/93) (kiai execution wiring)

**What ships**:

**Kataka system**:
- `KatakaRegistry` — infrastructure service scanning `.claude/agents/` for `-ka.md` files, parsing frontmatter, returning typed kataka list
- `kata agent list` / `kata agent inspect` (alias: `kata kataka`) — kataka registry display with `--json`
- `FlavorSchema` extension — add optional `kataka?: string` field for ryu binding
- Init scanner — `kata init --scan basic|full|resync` with LLM classification, wrapper generation, orphan detection
- KATA.md population — after scanning, fill kataka registry section

**Skills** (6 new skill files shipped with kata):
- `kata-orchestration` — shared kataka protocol with observation recording instructions
- `kata-sensei` — orchestration playbook (step next, flavor selection, team spawning, gate handling, synthesis)
- `kata-create-agent` — naming guide + quality criteria + templates
- `kata-create-skill` — Agent Skills spec + eval generation
- `kata-bridge-gap` — gap analysis → creation → integration pipeline
- `kata-scan-project` — project scanning + classification + wrapper generation

**CLI**:
- `kata lexicon` TUI (alias: `kata kotoba`) — interactive vocabulary table
- `kata --help` lexicon appendix via `addHelpText('after', ...)`
- `kata kiai` flags restored — `--yolo`, `--kata`, `--gyo` (from Epic #93)

**Scope**: ~3 schemas, ~5 CLI commands, ~6 skill files, ~80 tests. 2–3 sessions.

**Parallel agents** (4):
- A: KatakaRegistry + `kata agent` CLI
- B: Init scanner + LLM classification + orphan detection (after A delivers interface)
- C: All 6 skill files (pure markdown authoring)
- D: FlavorSchema extension + lexicon TUI + help enhancement + kiai flags

**Blocks**: Wave F (observation schema needed by skill instructions, KATA.md template needed).

---

### Wave H: "Intelligence" — Detection Engines

**Addresses**: P2 ([#138](https://github.com/cmbays/kata/issues/138)), P3 ([#139](https://github.com/cmbays/kata/issues/139)), P5 ([#141](https://github.com/cmbays/kata/issues/141)), P7 ([#143](https://github.com/cmbays/kata/issues/143))

**What ships**:

**Prediction subsystem** (P2):
- Prediction observation subtypes (quantitative + qualitative), `kata predict` CLI
- Prediction-to-outcome matching during cooldown
- 4 calibration detection algorithms (overconfidence, domain bias, estimation drift, predictor divergence)
- Severity-weighted thresholds (3/5/8 observations)

**Friction subsystem** (P3):
- Friction observation with `contradicts` field, 5-type taxonomy
- Override detection (count + rate thresholds)
- 4 resolution paths (invalidate, scope, synthesize, escalate) with confidence gating
- Stage prompt guidance for friction logging

**Learning permanence** (P5):
- TTL enforcement — auto-archive expired operational, flag stale strategic in cooldown
- Confidence decay by tier (computed at read time)
- Constitutional immutability (archive or override, never modify)
- Promotion/demotion lifecycle
- Constitutional pack loader + generic domain-agnostic pack
- Opinion level (light/strong) interaction

**Hierarchical capture** (P7):
- Observation capture at step/flavor/stage/cycle levels (paths from Wave F)
- `KnowledgeStore` upgrades — `loadForStep()`, `loadForFlavor()`, archive/resurrection logic
- Inter-level promotion schema (step pattern → flavor learning when 3+ observations)

**Scope**: ~4 sub-schemas, ~2 CLI commands, ~150 tests. 3–4 sessions.

**Parallel agents** (4):
- A: Prediction subsystem
- B: Friction subsystem
- C: Learning permanence + constitutional packs
- D: Hierarchical capture + KnowledgeStore upgrades

**Blocks**: Wave F (observation schema, learning enrichment, run tree paths).

---

### Wave I: "Synthesis" — LLM Intelligence + Observability

**Addresses**: P4 ([#140](https://github.com/cmbays/kata/issues/140)), P6 ([#142](https://github.com/cmbays/kata/issues/142)), Kataka Phase 4 (observability + attribution)

**What ships**:

**LLM synthesis** (P6):
- Three-step pipeline: filter (rules-based) → detect (Sonnet-class) → synthesize (Opus-class)
- `SynthesisProposal` schema — 5 types (new-learning, update-learning, promote, archive, methodology-recommendation)
- Citation requirement (2+ sources or rejection)
- Configurable depth (quick/standard/thorough)
- Cooldown integration at step 6 (after reflection + friction detection)
- User interaction: auto-apply high confidence, present low confidence, --yolo auto-applies

**Domain confidence** (P4):
- 4-axis tag vocabulary: domain (~15), language family (13 enum), framework (open), architecture (~10), work characterization (~14 + scope/novelty)
- Tag storage on Bet and RunState (`domainTags?` optional field)
- 3 tag sources: user, auto-detected, LLM-inferred
- Composite confidence score (familiarity + risk + historical performance)
- Materialized during cooldown, informational injection into prompts
- `kata status` / `kata stats` surface domain confidence

**Kataka observability** (Phase 4):
- Agent attribution — `katakaId` populated from sensei → team task → observation writer
- Cooldown aggregation by kataka
- Agent-level learnings (stored with `agentId` matching kataka name)
- Learning injection into KATA.md kataka section
- `kata agent inspect` wired to real run/observation/decision data
- KATA.md cooldown refresh — write new project-wide learnings after synthesis

**Scope**: ~5 schemas, ~2 CLI commands, ~120 tests. 3–4 sessions.

**Parallel agents** (3):
- A: LLM synthesis pipeline
- B: Domain confidence map
- C: Kataka observability + KATA.md cooldown update

**Blocks**: Wave H (predictions/friction/permanence feed synthesis), Wave G (kataka registry for attribution).

---

### Wave J: "Mastery" — Belt System + Gap Bridging

**Addresses**: [#152](https://github.com/cmbays/kata/issues/152) (belt ranking), Kataka Phase 3 (gap bridging enhancement), Kataka Phase 5 (per-kataka confidence)

**What ships**:

**Belt system** ([#152](https://github.com/cmbays/kata/issues/152)):
- `BeltLevel` enum + `computeBelt()` evaluating criteria against project state
- Belt computation during cooldown
- Storage in `.kata/project-state.json`
- Go-kyu checklist tracking
- Belt display in `kata status` with thematic presentation
- Level-up celebration display
- No-downgrade enforcement

**Gap bridging**:
- `kata-bridge-gap` skill enhanced — full GapReport → resource creation → integration
- `--bridge-gaps` flag on `kata execute` for mid-run self-healing
- Quality gates on created resources

**Per-kataka domain confidence** (Phase 5):
- Kataka-attributed observations feed per-agent confidence
- Kataka performance contributes to belt criteria

**Scope**: ~3 schemas, ~80 tests. 2 sessions.

**Parallel agents** (3):
- A: Belt system
- B: Gap bridging
- C: Per-kataka confidence + creation tooling refinement

**Blocks**: Wave I (synthesis for belt criteria, domain confidence, kataka attribution).

---

### Wave K: "Dojo" — Personal Training Environment

**PR**: [#172](https://github.com/cmbays/kata/pull/172) merged (2026-02-28). 2148 tests, 109 files.

**What shipped**:

- `src/domain/types/dojo.ts` — 8 Zod schemas (DiaryEntry, Topic, ContentSection, Source, Session, SessionMeta, SessionIndex, SourceRegistry)
- `src/infrastructure/dojo/` — DiaryStore, SessionStore, SourceRegistry
- `src/features/dojo/` — DiaryWriter (cooldown integration), DataAggregator, SessionBuilder, HtmlGenerator, design system with Japanese dojo theme
- `src/cli/commands/dojo.ts` — `kata dojo list`, `kata dojo open`, `kata dojo inspect`, `kata dojo diary`, `kata dojo diary write`, `kata dojo sources`, `kata dojo generate`
- `src/cli/formatters/dojo-formatter.ts` — session/diary/source formatting
- Cooldown integration — diary entries written automatically after each cooldown
- Init integration — `.kata/dojo/` directory structure created at init
- Skill files — `skill/dojo.md`, `skill/dojo-research.md`
- Default curated sources — `dojo/default-sources.json`

**Blocks**: Nothing — Wave K is a consumer of data produced by Waves F–J. It reads whatever data exists and works with the current data model.

---

## Dependency Graph

```text
Wave K ── DONE (no dependencies — reads existing data)

Wave F ──blocks──> Wave G (observation schema needed by skills)
Wave F ──blocks──> Wave H (observation schema, learning enrichment, run tree paths)
Wave G ──blocks──> Wave I (kataka registry for attribution, flavor binding)
Wave H ──blocks──> Wave I (predictions/friction/permanence feed synthesis)
Wave I ──blocks──> Wave J (synthesis for belt criteria, domain confidence, attribution)

Within waves:
  F: Schemas (A) -> Infrastructure (C); Config (B) independent
  G: KatakaRegistry (A) -> Scanner (B); Skills (C) independent; FlavorSchema (D) independent
  H: Permanence (C) before Friction (B) resolution paths; all others independent
  I: Synthesis (A) before KATA.md update (part of C); Domain confidence (B) independent
```

---

## Gap Analysis — New Issues Needed

12 new issues to create, plus updates to existing issues:

### New Issues

| # | Title | Wave | Relates to |
|---|---|---|---|
| G-1 | `kata observe` CLI command (alias: kansatsu) for observation recording | F | [#137](https://github.com/cmbays/kata/issues/137) |
| G-2 | KATA.md generation at init + cooldown refresh mechanism | F, I | Kataka Phase 1, [#142](https://github.com/cmbays/kata/issues/142) |
| G-3 | run-store path extensions for observations/reflections at all levels | F | [#137](https://github.com/cmbays/kata/issues/137), [#143](https://github.com/cmbays/kata/issues/143) |
| G-4 | `kataka?` field on FlavorSchema for agent binding | G | Kataka Phase 1 |
| G-5 | KatakaRegistry infrastructure service | G | Kataka Phases 1–2 |
| G-6 | `kata agent` CLI commands (list, inspect, alias: kataka) | G | Kataka Phase 4 |
| G-7 | Update kata-orchestration skill with observation recording protocol | G | [#137](https://github.com/cmbays/kata/issues/137), Kataka Phase 1 |
| G-8 | `kata kiai` flags (--yolo, --kata, --gyo) + sensei-driven execution | G | [#93](https://github.com/cmbays/kata/issues/93) |
| G-9 | Generic constitutional learning pack (domain-agnostic best practices) | H | [#141](https://github.com/cmbays/kata/issues/141) |
| G-10 | `kata predict` CLI command for prediction observations | H | [#138](https://github.com/cmbays/kata/issues/138) |
| G-11 | KATA.md cooldown refresh (write synthesis learnings back) | I | [#142](https://github.com/cmbays/kata/issues/142), Kataka Phase 4 |
| G-12 | project-state.json + belt computation during cooldown | J | [#152](https://github.com/cmbays/kata/issues/152) |

### Updates to Existing Issues

- **#137** — Add: "All observation variants include optional `katakaId?: string`" and "Extend runPaths() with observation/reflection paths"
- **#138** — Add: "`kata predict` CLI command is a deliverable"
- **#153** — `kata kime` alias (closed, implemented)
- **#93** — Update body noting resolved gaps; create G-8 as sole child issue; close or defer remaining
- **#55** — Close (all sub-issues done)

---

## Belt Integration Points

| Wave | Belts Unlocked | Key Enablers |
|---|---|---|
| G | Mukyu, Go-kyu | Init, first run/cycle/cooldown already trackable from existing infra |
| H | Yon-kyu, San-kyu (partial) | Predictions, permanence, constitutional learnings, gap tracking |
| I | San-kyu (full), Ni-kyu | Synthesis, domain confidence, cross-run patterns, kataka attribution |
| J | Ik-kyu, Shodan | Belt computation, methodology validation, per-kataka confidence |

`computeBelt()` ships in Wave J but can be designed to gracefully report progress toward each rank from any wave onward.

---

## Epic #93 Disposition

Most #93 gaps are already resolved:
- Gate approval (`kata approve`) — shipped in Wave A
- Cycle start (`kata cycle start`) — shipped in Wave A
- Pipeline-bet association (`RunSchema.betId`) — already in schema
- `kata watch` TUI — shipped in Wave D

**Remaining**: `kata kiai` full wiring + flags (--yolo, --kata, --gyo). This is subsumed by Wave G's sensei skill work. One child issue (G-8) covers it.

**Multi-pipeline global TUI view**: Defer to post-v1 polish. Single-pipeline `kata watch` + `kata status --json` covers v1.

---

## Publishing (#56) Note

Epic #56 (npm publish) is unblocked by any of this work and can proceed in parallel at any time. It's orthogonal to the kataka/meta-learning integration.

---

*This is a living document. Update it as waves are implemented.*
