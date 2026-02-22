# kata — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan.

**Goal:** Build kata, a Development Methodology Engine — TypeScript library + CLI that encodes development methodology as executable, composable stages with a self-improving knowledge system.

**Architecture:** Clean architecture (domain → infrastructure → features → shared → cli) in a standalone npm package. Domain layer defines Zod schemas and pure services with zero dependencies. Infrastructure layer provides JSON-file persistence, execution adapters, and registries. Features layer contains application-level use cases (init, pipeline-run, cycle-management, self-improvement). CLI layer is thin Commander.js wrappers over features.

**Tech Stack:** TypeScript (strict), Zod (schema-first types), Commander.js (CLI framework, D14), @inquirer/prompts (interactive prompts), Vitest (testing), Node.js native fs/path (file I/O). No database — JSON files in `.kata/` directory.

**Repo:** Separate from print-4ink (D9). Package name: `kata` (D16). Scoped npm: `@withkata/core`.

**Reference docs:**
- `docs/pipeline/shaping.md` — R0-R8, Shape A (A1-A9), D1-D17
- `docs/pipeline/breadboard.md` — Places, affordances, wiring, slices V1-V9
- `docs/pipeline/spike-*.md` — 4 resolved spikes

---

## Wave Structure

```
Wave 0: Foundation (serial, 1 session)
  └── kata-foundation

Wave 1: Services (parallel, 3 sessions)
  ├── stage-pipeline-manifest
  ├── cycle-budget
  └── knowledge-adapters

Wave 2: Application Layer (parallel, 2 sessions)
  ├── cli-init
  └── pipeline-runner

Wave 3: Intelligence (parallel, 2 sessions)
  ├── self-improvement
  └── cooldown-proposals

Wave 4: Polish (serial, 1 session)
  └── kata-polish
```

**Dependency DAG:**

```
W0: kata-foundation
  │
  ├──→ W1: stage-pipeline-manifest ──→ W2: cli-init ──────→ W3: self-improvement ──→ W4: kata-polish
  ├──→ W1: cycle-budget ─────────────→ W2: cli-init ──────→ W3: cooldown-proposals ─→ W4: kata-polish
  └──→ W1: knowledge-adapters ───────→ W2: pipeline-runner ─→ W3: (both) ────────────→ W4: kata-polish
                                       W2: pipeline-runner ─→ W3: (both)
```

**Total:** 5 waves, 9 sessions. Critical path: W0 → W1 → W2:pipeline-runner → W3 → W4 (5 waves sequential).

---

## Wave 0: Foundation

> Serial. 1 session. Creates the kata repository with all types, utilities, and project structure.

### Task 0.1: Create Repository and Project Structure

**Topic:** `kata-foundation`

**Files to create:**

```
kata/
  src/
    domain/
      types/
        stage.ts           # StageSchema, StageType, StageFlavor
        pipeline.ts        # PipelineSchema, PipelineState
        cycle.ts           # CycleSchema, CycleState
        gate.ts            # GateSchema, GateCondition, GateResult
        artifact.ts        # ArtifactSchema, ArtifactDefinition
        bet.ts             # BetSchema, BetOutcome
        learning.ts        # LearningSchema, LearningTier, LearningCategory
        manifest.ts        # ExecutionManifestSchema
        index.ts           # Barrel export
    infrastructure/
      persistence/
        json-store.ts      # Generic typed JSON file read/write/validate
        json-store.test.ts
    shared/
      lib/
        logger.ts          # Structured logger (pino or custom)
        errors.ts          # Domain error types
        index.ts
    cli/
      index.ts             # Commander program skeleton + bin entry
      program.ts           # Program definition with subcommand registration
  package.json
  tsconfig.json
  vitest.config.ts
  .gitignore
  .eslintrc.js
  README.md                # Minimal — expanded in Wave 4
```

**Steps:**

1. Create GitHub repo `kata` (or `@withkata/core`)
2. Initialize with TypeScript strict config, ESM modules, Node.js 20+
3. Install dependencies:
   - `zod` (schema validation)
   - `commander` (CLI framework)
   - `@inquirer/prompts` (interactive prompts)
   - Dev: `vitest`, `typescript`, `@types/node`, `eslint`
4. Define all 8 Zod schemas (A1):
   - `StageSchema` — type, flavor, gates, artifacts, promptTemplate ($ref), hooks, config
   - `PipelineSchema` — id, name, stages[], state, metadata, currentStageIndex
   - `CycleSchema` — id, budget, bets[], pipelineMappings[], state, timestamps
   - `GateSchema` — conditions[], artifacts[], thresholds
   - `ArtifactSchema` — name, schema (Zod ref), required, description
   - `BetSchema` — id, description, appetite, projectRef, issueRefs[], outcome
   - `LearningSchema` — id, tier, category, content, evidence[], confidence, stageType, timestamps
   - `ExecutionManifestSchema` — stageType, prompt, context, gates, artifacts, learnings
5. Create `JsonStore<T>` utility:
   - `read<T>(path, schema): T` — read + validate
   - `write<T>(path, data, schema): void` — validate + write
   - `exists(path): boolean`
   - `list(dir, schema): T[]` — read all files in directory
6. Create Commander.js program skeleton:
   - `kata` binary with version, description
   - Subcommand registration pattern (each feature registers commands)
   - `--json` global flag for machine-readable output
   - `--verbose` global flag for debug output
7. Write tests for all schemas (edge cases, validation failures)
8. Write tests for JsonStore

**Acceptance:**
- `npm test` passes with all schema validation tests
- `npx kata --version` prints version
- `npx kata --help` shows command structure (stubs)
- All types exportable via `import { StageSchema } from '@withkata/core'`

---

## Wave 1: Services

> Parallel. 3 sessions. All domain services and infrastructure components. Each depends only on Wave 0 types.

### Task 1.1: Stage Registry + Pipeline Composer + Manifest Builder

**Topic:** `stage-pipeline-manifest`
**Depends on:** `kata-foundation`

**Breadboard refs:** A2 (N10-N14), A3 (N20-N23), A5 (N40-N43)

**Files:**

```
src/
  infrastructure/
    registries/
      stage-registry.ts       # StageRegistry class
      stage-registry.test.ts
  domain/
    services/
      pipeline-composer.ts     # PipelineComposer class
      pipeline-composer.test.ts
      manifest-builder.ts      # ManifestBuilder class
      manifest-builder.test.ts
  infrastructure/
    config/
      ref-resolver.ts          # $ref resolution for prompt templates
      ref-resolver.test.ts
stages/
  builtin/
    research.json              # 8 built-in stage definitions
    interview.json
    shape.json
    breadboard.json
    plan.json
    build.json
    review.json
    wrap-up.json
  prompts/
    research.md                # 8 self-sufficient prompt templates
    interview.md
    shape.md
    breadboard.md
    plan.md
    build.md
    review.md
    wrap-up.md
templates/
  vertical.json                # 5 built-in pipeline templates
  bug-fix.json
  polish.json
  spike.json
  cooldown.json
```

**Steps:**

1. **Stage Registry (A2):**
   - `register(stage: Stage): void` (N10) — validate + persist to `.kata/stages/`
   - `get(type: string, flavor?: string): Stage` (N11) — resolve by type + optional flavor
   - `list(filter?: StageFilter): Stage[]` (N12) — list with optional filtering
   - `loadBuiltins(): void` (N13) — register all 8 built-in stages from `stages/builtin/`
   - `loadCustom(configPath: string): void` (N14) — load user-defined stages
   - Tests: registration, retrieval, filtering, built-in loading, custom loading, duplicate handling

2. **Pipeline Composer (A3):**
   - `define(stages: StageRef[]): Pipeline` (N20) — create pipeline from stage references
   - `validate(pipeline: Pipeline): ValidationResult` (N21) — gate compatibility check (stage N exit ⊇ stage N+1 entry)
   - `loadTemplates(): void` (N22) — load built-in pipeline templates from `templates/`
   - `instantiate(template: string, context: PipelineContext): Pipeline` (N23) — create pipeline instance from template + context
   - Tests: composition, validation (valid chain, invalid gate mismatch), template loading, instantiation

3. **Manifest Builder (A5):**
   - `build(stage: Stage, context: ExecutionContext, learnings: Learning[]): ExecutionManifest` (N40) — compose manifest
   - `resolveRefs(template: string): string` (N41) — replace `$ref` with file content
   - `attachGates(manifest: ExecutionManifest, stage: Stage): void` (N42) — add gate definitions
   - `injectLearnings(manifest: ExecutionManifest, learnings: Learning[]): void` (N43) — add learning context
   - Tests: manifest generation, $ref resolution, gate attachment, learning injection

4. **Built-in stages:** Write 8 stage JSON definitions following `StageSchema`. Each includes entryGate, exitGate, artifactSchemas, learningHooks, promptTemplate ($ref to .md file).

5. **Prompt templates:** Write 8 self-sufficient prompt .md files. Each guides any LLM through the stage without specialized agents. These are the null-state execution path (R5).

6. **Pipeline templates:** Write 5 pipeline template JSON files defining stage sequences for each pipeline type.

**Acceptance:**
- All registry operations work with built-in stages
- Pipeline validation catches gate mismatches
- Manifest builder produces valid ExecutionManifest from any stage
- $ref resolution reads .md files and injects content
- 90%+ test coverage

### Task 1.2: Cycle Manager + Token Tracker

**Topic:** `cycle-budget`
**Depends on:** `kata-foundation`

**Breadboard refs:** A4 (N30-N35), Token Tracker (N94-N95)

**Files:**

```
src/
  domain/
    services/
      cycle-manager.ts         # CycleManager class
      cycle-manager.test.ts
    rules/
      budget-rules.ts          # Budget constraint evaluation
      budget-rules.test.ts
      dependency-rules.ts      # Cross-bet dependency detection
      dependency-rules.test.ts
  infrastructure/
    tracking/
      token-tracker.ts         # TokenTracker class
      token-tracker.test.ts
      jsonl-parser.ts          # Claude JSONL file parser
      jsonl-parser.test.ts
```

**Steps:**

1. **Cycle Manager (A4):**
   - `create(budget: Budget): Cycle` (N30) — create cycle with token/time budget
   - `addBet(cycleId: string, bet: Bet): Cycle` (N31) — add bet with appetite
   - `mapPipeline(betId: string, pipelineId: string): void` (N32) — link pipeline to bet
   - `getBudgetStatus(cycleId: string): BudgetStatus` (N33) — current usage vs budget
   - `checkDependencies(cycleId: string): DependencyReport` (N34) — warn on cross-bet deps
   - `generateCooldown(cycleId: string): CooldownReport` (N35) — cycle retrospective data
   - Tests: creation, bet management, budget tracking, dependency detection, cooldown generation

2. **Budget Rules:**
   - Budget threshold alerts at 75%, 90%, 100% (R3, spike-token-budget.md)
   - Appetite validation (total bets must not exceed 100% minus cooldown reserve)
   - Budget is a constraint, not a hard stop (Shape Up philosophy)

3. **Dependency Rules:**
   - Detect cross-bet dependencies (methodology smell per D5)
   - Suggest: combine bets, sequence across cycles, or decouple
   - Warn, don't block (D5)

4. **Token Tracker:**
   - `recordUsage(stageId: string, jsonlPath?: string): TokenUsage` (N94) — parse Claude JSONL, extract token counts
   - `checkBudget(cycleId: string): BudgetAlert[]` (N95) — evaluate current usage against cycle budget
   - JSONL parser: extract `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` from Claude session files

5. **JSONL Parser:**
   - Read `~/.claude/projects/{encoded-path}/*.jsonl` files
   - Parse per-turn token counts from usage objects
   - Sum totals per session file

**Acceptance:**
- Cycle CRUD with budget constraints
- Dependency warnings for cross-bet deps
- Token tracking from real Claude JSONL files
- Budget alerts fire at correct thresholds
- 90%+ test coverage

### Task 1.3: Knowledge Store + Execution Adapters

**Topic:** `knowledge-adapters`
**Depends on:** `kata-foundation`

**Breadboard refs:** A7 (N60-N66), A6 (N50-N54)

**Files:**

```
src/
  infrastructure/
    knowledge/
      knowledge-store.ts       # KnowledgeStore class
      knowledge-store.test.ts
      subscription-manager.ts  # Category subscription management
      subscription-manager.test.ts
    execution/
      execution-adapter.ts     # IExecutionAdapter port interface
      manual-adapter.ts        # ManualAdapter — prints instructions
      manual-adapter.test.ts
      claude-cli-adapter.ts    # ClaudeCliAdapter — spawns Claude CLI
      claude-cli-adapter.test.ts
      composio-adapter.ts      # ComposioAdapter — calls ao spawn
      composio-adapter.test.ts
      adapter-resolver.ts      # AdapterResolver — config-based resolution
      adapter-resolver.test.ts
```

**Steps:**

1. **Knowledge Store (A7):**
   - `capture(stageType: string, learning: Learning): void` (N60) — persist learning
   - `query(filter: LearningFilter): Learning[]` (N61) — query with filters
   - `loadForStage(stageType: string): Learning[]` (N62) — Tier 1 auto-load
   - `loadForSubscriptions(agentId: string): Learning[]` (N63) — Tier 2 subscription-based
   - `loadForAgent(agentId: string): Learning[]` (N64) — Tier 3 agent-specific
   - `subscribe(agentId: string, categories: string[]): void` (N65) — manage subscriptions
   - `stats(): KnowledgeStats` (N66) — summary statistics
   - Tests: CRUD, tiered loading, subscriptions, filtering, stats

2. **Subscription Manager:**
   - Manage agent → category subscription mappings (S6)
   - Subscribe/unsubscribe operations
   - Resolve subscriptions to learning queries

3. **Execution Adapters (A6):**
   - `IExecutionAdapter` port interface: `execute(manifest: ExecutionManifest): Promise<ExecutionResult>` (N50)
   - `ManualAdapter` (N52) — formats manifest as human-readable instructions, prints to terminal
   - `ClaudeCliAdapter` (N51) — spawns `claude` CLI with manifest as prompt. Reads session JSONL for results.
   - `ComposioAdapter` (N53) — calls `ao spawn` with manifest context. Placeholder for v1.
   - `AdapterResolver` (N54) — reads `.kata/config.json`, resolves adapter by name

4. **Config-based adapter resolution (D14, D8):**
   - `.kata/config.json` contains `execution.adapter: "manual" | "claude-cli" | "composio" | "custom"`
   - Resolver maps name → adapter instance
   - Null state defaults to `manual` adapter (R5)

**Acceptance:**
- 3-tier knowledge loading works correctly
- Subscriptions filter learnings by category
- ManualAdapter produces readable terminal output
- ClaudeCliAdapter spawns claude process (integration test with mock)
- AdapterResolver picks correct adapter from config
- 90%+ test coverage

---

## Wave 2: Application Layer

> Parallel. 2 sessions. Wire services into features and CLI commands.

### Task 2.1: CLI Framework + Init Wizard + Commands

**Topic:** `cli-init`
**Depends on:** `stage-pipeline-manifest`, `cycle-budget`, `knowledge-adapters`

**Breadboard refs:** A9 (N80-N89 except N83-N84), P2 (Init Wizard), P4 (Cycle Wizard)

**Files:**

```
src/
  features/
    init/
      init-handler.ts          # handleInit() orchestration
      init-handler.test.ts
      project-detector.ts      # Detect existing project state
      project-detector.test.ts
  cli/
    commands/
      init.ts                  # kata begin (init wizard)
      stage-list.ts            # kata form list
      stage-inspect.ts         # kata form inspect
      cycle-new.ts             # kata practice new
      cycle-status.ts          # kata practice status
      cycle-bet.ts             # kata practice focus
      cycle-cooldown.ts        # kata reflect
      knowledge-query.ts       # kata memory query
      knowledge-stats.ts       # kata memory stats
    formatters/
      stage-formatter.ts       # Terminal formatting for stage output
      cycle-formatter.ts       # Terminal formatting for cycle output
      knowledge-formatter.ts   # Terminal formatting for knowledge output
```

**Steps:**

1. **Init Handler (N80, P2):**
   - `handleInit()` orchestrates: detect project → prompt methodology → prompt adapter → create .kata/ → load builtins → load templates → display summary
   - Project detection: check for `.kata/` dir, `package.json`, `.git/`
   - Interactive prompts (U21-U23): methodology framework, execution adapter, template confirmation
   - Creates `.kata/config.json` (S1), loads built-in stages (S2), loads pipeline templates (S3)
   - Summary output (U24): files created, next steps

2. **CLI Commands (thin wrappers):**
   - `kata form list` (N81) → StageRegistry.list() → format as table
   - `kata form inspect <type>` (N82) → StageRegistry.get() → format detailed view
   - `kata practice new` (N85) → Cycle Wizard (budget prompt, bet entry, appetite, confirmation)
   - `kata practice status [id]` (N86) → CycleManager.getBudgetStatus() → format
   - `kata practice focus <cycle-id>` → CycleManager.addBet() → Cycle Wizard
   - `kata reflect <cycle-id>` (N87) → CycleManager.generateCooldown() → format
   - `kata memory query [--stage X]` (N88) → KnowledgeStore.query() → format
   - `kata memory stats` (N89) → KnowledgeStore.stats() → format

3. **Cycle Wizard (P4, U50-U55):**
   - Budget prompt (tokens and/or time box)
   - Bet entry loop (description, appetite, issue refs)
   - Dependency check display
   - "Add another bet?" loop
   - Cycle created summary

4. **Terminal Formatters:**
   - Stage table (type, flavor, gates, artifact count)
   - Stage detail (full definition with prompt preview)
   - Cycle summary (budget, bets, utilization %)
   - Knowledge table (tier, category, count, confidence)
   - Support `--json` flag for machine-readable output

**Acceptance:**
- `kata begin` creates `.kata/` with valid config and 8 stages
- `kata form list` shows all registered stages
- `kata form inspect research` shows full stage definition
- `kata practice new` walks through cycle creation
- `kata memory query` shows learnings (empty at null state)
- All commands support `--json` output
- 80%+ test coverage (CLI tests via Commander's test patterns)

### Task 2.2: Pipeline Runner

**Topic:** `pipeline-runner`
**Depends on:** `stage-pipeline-manifest`, `knowledge-adapters`

**Breadboard refs:** A9 partial (N83-N84, N91-N96), P3 (Pipeline Runner), P3.1 (Gate Check)

**Files:**

```
src/
  features/
    pipeline-run/
      pipeline-runner.ts       # PipelineRunner class (main loop)
      pipeline-runner.test.ts
      gate-evaluator.ts        # Gate evaluation logic
      gate-evaluator.test.ts
      result-capturer.ts       # Result capture + history
      result-capturer.test.ts
  cli/
    commands/
      pipeline-start.ts        # kata sequence start
      pipeline-status.ts       # kata sequence status
      pipeline-define.ts       # kata sequence define
    formatters/
      pipeline-formatter.ts    # Terminal formatting for pipeline output
      gate-formatter.ts        # Terminal formatting for gate results
```

**Steps:**

1. **Pipeline Runner (N91, P3):**
   - `run(pipelineId: string): Promise<PipelineResult>` — main traversal loop
   - For each stage:
     1. Evaluate entry gate (N92) → display result (U40-U41)
     2. If gate fails → override prompt: retry / skip / abort (U42)
     3. Load Tier 1 + subscribed learnings (N62, N63) → display summary (U32)
     4. Build execution manifest (N40) → display preview (U33)
     5. Resolve adapter (N54) → execute (N50) → display output (U34)
     6. Capture results (N93) → record tokens (N94) → write history (S8)
     7. Evaluate exit gate (N92 exit) → display validation (U35)
     8. Prompt for learning capture (U36) → store learning (N60)
     9. Advance to next stage (N96)
   - Pipeline complete → display summary (U38) → navigate to Learning Review (P6)

2. **Gate Evaluator (N92, P3.1):**
   - Evaluate gate conditions against current state
   - Check artifact existence and schema validation
   - Return GateResult (pass/fail + details per condition)
   - Support entry gates (preconditions) and exit gates (postconditions)

3. **Result Capturer (N93):**
   - Capture execution results (artifacts produced, timing, token usage)
   - Write to pipeline state (S3) and execution history (S8)
   - Integrate with TokenTracker (N94) for Claude JSONL parsing
   - Budget alert integration with CycleManager (N95) if pipeline mapped to cycle

4. **CLI Pipeline Commands:**
   - `kata sequence start <type> [--practice <id> --focus <id>]` (N83) — launches runner. Optional cycle/bet mapping via `--practice`/`--focus` args (F3 fix).
   - `kata sequence status [id]` (N84) — displays pipeline state, current stage, progress
   - `kata sequence define <stages...>` — creates custom pipeline definition (N20)

5. **Interactive Overrides (P3.1):**
   - Gate failure → prompt user: retry (re-evaluate), skip (proceed anyway), abort (return to shell)
   - Learning capture → free-text prompt for what worked / didn't work

**Acceptance:**
- Pipeline traversal works end-to-end with ManualAdapter (prints instructions per stage)
- Entry and exit gates evaluate correctly
- Gate failure presents retry/skip/abort options
- Learning capture persists to knowledge store
- Token tracking records usage when JSONL files available
- Budget alerts fire when pipeline mapped to cycle
- `kata sequence status` shows pipeline progress
- 80%+ test coverage

---

## Wave 3: Intelligence

> Parallel. 2 sessions. Self-improvement and cooldown analysis.

### Task 3.1: Self-Improving Loop

**Topic:** `self-improvement`
**Depends on:** `pipeline-runner`, `knowledge-adapters`

**Breadboard refs:** A8 (N70-N73), P6 (Learning Review)

**Files:**

```
src/
  features/
    self-improvement/
      learning-extractor.ts        # LearningExtractor class
      learning-extractor.test.ts
      prompt-updater.ts            # Prompt template update logic
      prompt-updater.test.ts
  cli/
    commands/
      learning-review.ts           # Learning review interactive session (P6)
    formatters/
      learning-formatter.ts        # Diff display for prompt updates
```

**Steps:**

1. **Learning Extractor (N70-N72):**
   - `analyze(history: ExecutionHistory[]): Pattern[]` (N70) — find recurring patterns across pipeline runs
   - `suggestLearnings(patterns: Pattern[]): SuggestedLearning[]` (N71) — propose Tier 1/2 learnings
   - `suggestPromptUpdates(learnings: Learning[], stages: Stage[]): PromptUpdate[]` (N72) — propose prompt template changes

2. **Pattern detection:**
   - Same stage type across multiple runs → compare success/failure patterns
   - Threshold: 3+ consistent observations → suggest as learning (D13 — track actuals first)
   - Confidence scoring based on evidence count and consistency

3. **Learning Review (P6, U70-U74):**
   - Display each suggested learning with tier, category, evidence (U70)
   - Accept / reject / edit each learning (U71)
   - Display proposed prompt updates as diffs (U72)
   - Accept / reject prompt updates (U73)
   - Apply accepted updates to stage definitions and prompt templates (N73)
   - Review summary (U74)

4. **Prompt Updater (N73):**
   - `apply(stageType: string, update: PromptUpdate): void` — update stage definition (S2) and/or prompt file (S7)
   - Backup original before updating
   - Validate updated prompt still resolves $refs

**Acceptance:**
- Pattern extraction finds recurring themes across 3+ pipeline runs
- Learning suggestions include tier, category, evidence, confidence
- Prompt update diffs are readable
- Applied updates produce valid stage definitions
- Learning review flow works interactively
- 80%+ test coverage

### Task 3.2: Cooldown + Cycle Proposals

**Topic:** `cooldown-proposals`
**Depends on:** `pipeline-runner`, `cycle-budget`

**Breadboard refs:** N35 (generateCooldown), P5 (Cooldown Session), V9

**Files:**

```
src/
  features/
    cycle-management/
      cooldown-session.ts          # Cooldown orchestration
      cooldown-session.test.ts
      proposal-generator.ts        # Next-cycle proposal logic
      proposal-generator.test.ts
  cli/
    formatters/
      cooldown-formatter.ts        # Terminal formatting for cooldown output
```

**Steps:**

1. **Cooldown Session (P5, U60-U64):**
   - Cycle retrospective summary (U60): completions, budget utilization, timeline
   - Per-bet outcome review (U61): complete / partial / abandoned + reasoning
   - Unblocked work display (U62): what this cycle's completions enable in the dependency graph
   - Next-cycle proposal (U63): suggested bets from dependency graph + learnings
   - Cooldown complete confirmation (U64)

2. **Proposal Generator:**
   - Read cycle dependency graph
   - Identify newly unblocked epics/bets
   - Factor in learnings from current cycle
   - Generate prioritized list of candidate bets for next cycle
   - Include rationale for each suggestion

3. **Enhance `kata reflect` command:**
   - Richer output formatting
   - Interactive bet outcome recording (mark each as complete/partial/abandoned)
   - Save outcomes to cycle state

**Acceptance:**
- Cooldown shows accurate budget utilization
- Per-bet outcomes are tracked
- Next-cycle proposals identify unblocked work
- Proposals include rationale
- 80%+ test coverage

---

## Wave 4: Integration + Polish

> Serial. 1 session. Final integration, thematic naming, testing, documentation.

### Task 4.1: Polish and Ship-Ready

**Topic:** `kata-polish`
**Depends on:** `self-improvement`, `cooldown-proposals`

**Steps:**

1. **Thematic CLI Naming (D17):**
   - Verify all CLI commands use kata vocabulary: form, sequence, practice, focus, reflect, memory, begin
   - Add command aliases for plain names (e.g., `kata stage` aliases to `kata form`)
   - Update `--help` text to use thematic language naturally
   - Verify tab completion works with thematic names

2. **End-to-End Integration Tests:**
   - Full pipeline run: `kata begin` → `kata sequence start vertical` → traverse all 8 stages → `kata reflect`
   - Cycle workflow: `kata practice new` → budget + bets → `kata sequence start --practice X --focus Y` → `kata reflect`
   - Knowledge accumulation: run 3 pipelines → verify learning suggestions appear
   - Null-state test: fresh directory → `kata begin` → `kata form list` → immediate value

3. **Error Handling:**
   - Graceful handling of missing `.kata/` directory (suggest `kata begin`)
   - Invalid stage/pipeline/cycle references
   - Corrupted JSON files (validate on load, suggest repair)
   - Missing Claude JSONL files (skip token tracking, warn)
   - Ctrl+C handling in interactive prompts

4. **Documentation:**
   - README.md: installation, quickstart, architecture overview, CLI reference
   - package.json: name, description, keywords, repository, bin field, exports
   - CONTRIBUTING.md: development setup, testing, architecture decisions
   - LICENSE: MIT (or as decided)

5. **npm Publishing Prep:**
   - Build configuration (tsup or tsc for compilation)
   - Dual package (ESM + CJS) or ESM-only
   - `bin` field pointing to CLI entry
   - `exports` field for library imports
   - `.npmignore` or `files` field
   - `prepublishOnly` script: lint + test + build

**Acceptance:**
- All E2E tests pass
- `kata --help` uses thematic naming with clear descriptions
- Error messages are helpful and actionable
- README provides 5-minute quickstart
- Package is npm-publishable
- No console.log/warn/error outside logger

---

## Session Sizing

| Wave | Session | Estimated Affordances | Complexity |
|------|---------|----------------------|------------|
| W0 | kata-foundation | 8 schemas + utilities | Medium (foundational) |
| W1 | stage-pipeline-manifest | 13 code + 8 stages + 5 templates + 8 prompts | High (most content) |
| W1 | cycle-budget | 8 code + JSONL parser | Medium |
| W1 | knowledge-adapters | 12 code (7 knowledge + 5 adapters) | Medium |
| W2 | cli-init | 10 CLI commands + init wizard + formatters | Medium-High |
| W2 | pipeline-runner | 6 code + CLI commands + interactive UI | High (core loop) |
| W3 | self-improvement | 4 code + review UI | Medium |
| W3 | cooldown-proposals | 3 code + proposal logic | Low-Medium |
| W4 | kata-polish | Integration + E2E + docs | Medium |

**Critical path sessions:** kata-foundation → stage-pipeline-manifest → pipeline-runner → kata-polish

**Highest complexity:** pipeline-runner (orchestration loop with 8 internal steps per stage iteration) and stage-pipeline-manifest (most files including 8 stage definitions and 8 prompt templates).

---

## Merge Strategy

Since this is a greenfield repo:

1. **Wave 0** merges to `main` first — establishes project structure and types
2. **Wave 1** sessions create files in non-overlapping directories — merge in any order
   - `stage-pipeline-manifest` → `src/infrastructure/registries/`, `src/domain/services/pipeline*`, `stages/`, `templates/`
   - `cycle-budget` → `src/domain/services/cycle*`, `src/domain/rules/`, `src/infrastructure/tracking/`
   - `knowledge-adapters` → `src/infrastructure/knowledge/`, `src/infrastructure/execution/`
3. **Wave 2** sessions touch `src/cli/commands/` (different files) and `src/features/` (different directories) — can merge in any order
4. **Wave 3** creates new feature directories — no conflicts
5. **Wave 4** touches CLI entry point, README, package.json — must be last

**Potential conflict points:**
- `src/cli/program.ts` — both Wave 2 sessions register commands. Resolve: Wave 0 creates the registration pattern, each session registers its own commands in separate files.
- `package.json` — Wave 0 installs all deps. No subsequent waves should modify it.

---

## Notes

- **This is a separate repo (D9)** — not part of print-4ink. The `work build` orchestrator may need adaptation for a different repo path.
- **Thematic naming (D17)** is applied in Wave 4, not during initial implementation. Domain language (stage, pipeline, cycle) is used throughout code. Thematic names (form, sequence, practice) are a CLI presentation layer.
- **Built-in prompt templates** are critical content — they ARE the null-state experience (R5). Invest quality time in Wave 1's stage-pipeline-manifest session writing these.
- **ComposioAdapter is a placeholder** for v1 — basic `ao spawn` integration. Full integration is a future cycle.
- **Knowledge graph backing (D11)** — JSON files in v1, Graphology upgrade path in v2+. The `KnowledgeStore` interface abstracts the backend.
