# Kata v3 Vision — Rust Port

> Future-looking implementation plan for porting kata from TypeScript to Rust. Not actionable until v1 is shipped, dogfooded, and the domain model is stable.
>
> **Companion documents**:
> - [v1 Product Design](../v1-product-design.md) — Current scope and success criteria
> - [v1 Design Rationale](../v1-design-vision.md) — ADR decisions (carry forward to Rust)
> - [Unified Roadmap](../unified-roadmap.md) — v1 wave implementation plan
> - [Knowledge Graph Vision](knowledge-graph-vision.md) — nanograph integration (post-v1)

---

## Version Strategy

| Version | Language | Focus | Status |
|---------|----------|-------|--------|
| **v0** | TypeScript | Iterate fast, ship features, dogfood | **Current** |
| **v1** | TypeScript | Stable product, npm publish, 50+ real keikos | Planned |
| **v2** | TypeScript | Strict enforcement, DAG pipelines, nanograph, multi-user | Planned |
| **v3** | Rust | Full port, single binary, retire TypeScript | This document |

**The v3 trigger**: v2 is stable, the domain model hasn't changed significantly in 3+ keiko cycles, and the integration surface (CLI, MCP, TUI, Dojo) is well-defined. Don't start sooner — every schema change during a port means doing the work twice.

---

## Why Rust

### Concrete gains over TypeScript

| Dimension | TypeScript (current) | Rust (v3) |
|-----------|---------------------|-----------|
| **Startup** | ~100-200ms (Node.js cold start) | <10ms |
| **Distribution** | Requires Node 20+ installed | Single binary, `cargo install` or curl |
| **Memory** | ~30-50MB baseline (Node.js) | ~5-10MB |
| **Type safety** | Zod runtime validation + TS compile-time | Compile-time exhaustiveness, `enum` with data, `Result<T, E>` |
| **Concurrency** | Single-threaded event loop | Tokio async, true parallelism for watch/TUI |
| **Binary size** | node_modules + bundled JS | ~10-20MB self-contained |

### What matters for kata specifically

- **Agent CLI invocations**: Agents call `kata kiai prepare`, `kata kansatsu record`, etc. hundreds of times per session. Every 150ms of startup overhead compounds into minutes of wasted agent time per keiko.
- **Always-on MCP server**: A slim MCP server in Rust uses minimal resources, starts instantly, and can run alongside the IDE with negligible footprint.
- **`kata watch` TUI**: Long-running terminal UI benefits from lower memory and better rendering performance under ratatui.
- **Distribution story**: `cargo install withkata` or a single binary download. No "do you have Node 20?" conversation.

### What we lose (and why it's acceptable)

- **Iteration speed drops**: Rust's compile-edit cycle is slower than `tsx`. Acceptable because v3 is a port of a stable system, not greenfield exploration.
- **Contributor accessibility**: Rust has a steeper learning curve than TypeScript. Acceptable because kata is currently a single-maintainer project with AI agents doing most of the implementation work.
- **npm ecosystem**: Commander, inquirer, chalk, ora have no direct equivalents. Acceptable because clap + ratatui + crossterm cover the same surface with different idioms.

---

## Architecture Mapping

The clean architecture carries over directly. Rust's module system maps naturally to the existing layer boundaries.

### TypeScript to Rust layer mapping

```
TypeScript                          Rust
─────────────────────────────────   ─────────────────────────────────
src/domain/types/    (Zod schemas)  → src/domain/types/    (serde structs + validators)
src/domain/services/ (pure logic)   → src/domain/services/ (pure logic, same signatures)
src/domain/ports/    (interfaces)   → src/domain/ports/    (traits)
src/infrastructure/  (JsonStore)    → src/infrastructure/  (serde_json + fs)
src/features/        (use cases)    → src/features/        (same orchestration)
src/cli/             (Commander.js) → src/cli/             (clap)
```

### Type system translation

| TypeScript + Zod | Rust equivalent | Notes |
|------------------|-----------------|-------|
| `z.object({...})` | `#[derive(Serialize, Deserialize)] struct` | serde handles JSON mapping |
| `z.enum([...])` | `enum` (unit variants) | Direct mapping |
| `z.discriminatedUnion(...)` | `#[serde(tag = "type")] enum` | Tagged enum with data |
| `z.optional(...)` | `Option<T>` | Direct mapping |
| `.default(value)` | `#[serde(default = "...")]` | serde default functions |
| `.refine(fn)` / `.superRefine(fn)` | `impl Validate for T` / custom trait | Manual validation functions |
| `z.infer<typeof Schema>` | The struct itself | No separate schema/type split needed |
| Path aliases (`@domain/*`) | `mod` + `use crate::domain::*` | Cargo module system |

### Port sequence (domain model example)

The 10 Zod schemas become 10 Rust modules:

```rust
// src/domain/types/stage.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stage {
    pub id: String,
    pub name: String,
    pub category: StageCategory,
    pub description: Option<String>,
    pub entry_gates: Vec<Gate>,
    pub exit_gates: Vec<Gate>,
    pub artifacts: Vec<ArtifactSpec>,
    pub prompt_template: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StageCategory {
    Research,
    Plan,
    Build,
    Review,
}
```

The Zod runtime validation disappears — replaced by serde's deserialization (which fails on malformed data) plus custom `validate()` methods where business rules need enforcement beyond shape.

---

## Presentation Modes

One binary, four modes. This is cleaner than what's achievable in TypeScript, where each would be a separate process or package.

```
kata (single Rust binary)
│
├── kata kiai ...          # CLI mode — clap
├── kata serve-mcp         # MCP server mode — JSON-RPC over stdio/SSE
├── kata kanshi            # TUI mode — ratatui + crossterm
├── kata dojo serve        # Training UI — axum + templates on localhost
│
├── domain/                # Shared across ALL modes
│   ├── types/             # serde structs (ported from Zod schemas)
│   ├── services/          # Pure logic (PipelineComposer, ManifestBuilder, CycleManager)
│   └── ports/             # Traits (IPersistence, IStageRegistry, IRefResolver)
│
├── infra/                 # JsonStore, registries, adapters, tracking
│   ├── persistence/       # serde_json file I/O (replaces JsonStore)
│   ├── knowledge/         # KnowledgeStore + nanograph client
│   ├── execution/         # AdapterResolver, SessionExecutionBridge
│   └── tracking/          # TokenTracker
│
└── features/              # Use cases (same as TS)
    ├── pipeline_run/
    ├── init/
    ├── self_improvement/
    └── cycle_management/
```

### CLI (clap)

Commander.js → clap is structurally direct. The kata lexicon (aliases) maps to clap's `visible_alias` attribute.

```rust
#[derive(Parser)]
#[command(name = "kata")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize a kata project
    #[command(visible_alias = "rei")]
    Init(InitArgs),

    /// Run focused execution sessions
    #[command(visible_alias = "kiai")]
    Execute(ExecuteArgs),

    /// Manage time-boxed work periods
    #[command(visible_alias = "keiko")]
    Cycle(CycleArgs),

    // ...
}
```

### MCP Server

MCP is JSON-RPC over stdio or SSE. Since the domain types are already serde structs, exposing resources is direct serialization — no translation layer.

```rust
// The MCP server and CLI share the same domain types.
// No serialization boundary between them.

async fn handle_resource_read(uri: &str) -> Result<Resource> {
    match uri {
        "kata://cycle/current" => {
            let cycle = cycle_manager.get_current()?;
            Ok(Resource::json(cycle)) // serde_json::to_value — same struct
        }
        "kata://pipeline/status" => { ... }
        "kata://knowledge/recent" => { ... }
        _ => Err(McpError::NotFound(uri))
    }
}
```

**Key MCP resources to expose** (define surface in TS v1/v2, port in v3):

| Resource URI | Description | Agent use case |
|-------------|-------------|----------------|
| `kata://cycle/current` | Active keiko with bets, budgets, status | Always-on context for cycle awareness |
| `kata://run/{id}/context` | Agent context for a specific run | Replaces `kata kiai context` CLI call |
| `kata://knowledge/relevant?stage={s}` | Learnings relevant to current stage | Inject bunkai without CLI round-trip |
| `kata://project/status` | Belt, stats, recent kime, active runs | Dashboard-level project awareness |
| `kata://pipeline/{id}/gates` | Gate status for active pipeline | Agent knows what's needed next |

### TUI (ratatui)

`kata watch` / `kata kanshi` becomes a ratatui application. Lower memory, better rendering, true async event handling via tokio.

```rust
// Conceptual — ratatui immediate-mode rendering
fn render_watch(frame: &mut Frame, state: &WatchState) {
    let layout = Layout::vertical([
        Constraint::Length(3),  // header
        Constraint::Min(10),   // run status
        Constraint::Length(5), // activity log
    ]).split(frame.area());

    frame.render_widget(header_widget(state), layout[0]);
    frame.render_widget(run_table(state), layout[1]);
    frame.render_widget(activity_log(state), layout[2]);
}
```

### Dojo Training Server (axum)

The Dojo currently generates static HTML. In Rust, axum provides a lightweight local server for interactive sessions with minimal overhead.

```rust
// Lightweight local server for dojo training sessions
let app = Router::new()
    .route("/sessions", get(list_sessions))
    .route("/sessions/:id", get(render_session))
    .route("/diary", get(render_diary))
    .nest_service("/static", ServeDir::new("assets"));

// Templating via minijinja or askama
// Sessions use the same domain types as CLI
```

---

## nanograph Integration

> See [Knowledge Graph Vision](knowledge-graph-vision.md) for the full schema and phased integration plan.

nanograph integration begins in v2 (TypeScript, behind the `KnowledgeStore` port interface) and carries forward into v3. The Rust port benefits from nanograph's native Rust core — no FFI boundary.

| Phase | Version | What happens |
|-------|---------|-------------|
| Phase 1 | v2 (TS) | KnowledgeStore backed by nanograph via `nanograph-db` npm package |
| Phase 2 | v2 (TS) | Execution entities (runs, kime, kansatsu) as graph nodes |
| Phase 3 | v2 (TS) | Cooldown synthesis reads graph relationships |
| Phase 4 | v3 (Rust) | Native nanograph crate — no npm/FFI overhead |
| Phase 5 | v3 (Rust) | Graph-powered agent context, visualization, nanoQL queries |

In v3, the KnowledgeStore trait implementation switches from the nanograph npm SDK to the native Rust crate. The port interface (`KnowledgeStore` trait) stays the same — only the implementation changes.

---

## Port Strategy

### Principles

1. **Port the tests first, then make them pass.** The 3000+ vitest tests are the behavioral contract. Translate them to Rust test functions. The port is done when all tests pass.
2. **Port layer by layer, inside out.** Domain types first (no dependencies), then domain services, then infrastructure, then features, then CLI. Each layer compiles and tests independently.
3. **JSON compatibility is non-negotiable.** v3 must read/write the same `.kata/` directory structure as v1/v2. Users upgrade by replacing the binary — no migration tool.
4. **AI agents do the mechanical translation.** The domain and infrastructure layers are repetitive translation work — ideal for AI-assisted porting. Human effort concentrates on the CLI/TUI layer where idioms differ most.
5. **Ship incrementally.** The Rust binary can coexist with the npm package during transition. Users can try `kata-rs` while keeping the TS version installed.

### Phase plan

```
Phase 1: Domain types (2-3 sessions)
├── Port all 10 Zod schemas to serde structs
├── Port validation logic to impl blocks
├── Port domain type tests
└── Verify: JSON round-trip compatibility with TS-generated .kata/ files

Phase 2: Domain services (2-3 sessions)
├── Port PipelineComposer, ManifestBuilder, CycleManager
├── Port service tests
└── Verify: same outputs given same inputs as TS

Phase 3: Infrastructure (3-4 sessions)
├── Port JsonStore → serde_json file I/O
├── Port StageRegistry, KnowledgeStore, TokenTracker
├── Port AdapterResolver, SessionExecutionBridge
├── Wire nanograph Rust crate (if available) or JSON fallback
└── Verify: reads existing .kata/ directories correctly

Phase 4: Features (3-4 sessions)
├── Port PipelineRunner, GateEvaluator, ResultCapturer
├── Port InitHandler, CooldownSession, ProposalGenerator
├── Port LearningExtractor, PromptUpdater
└── Verify: end-to-end workflows match TS behavior

Phase 5: CLI (3-4 sessions)
├── Build clap command structure with full lexicon aliases
├── Port formatters (stage, pipeline, cycle, gate, knowledge, learning)
├── Port interactive prompts (dialoguer or inquire crate)
└── Verify: CLI output matches TS for --json mode; themed output is equivalent

Phase 6: TUI + MCP + Dojo (3-4 sessions)
├── Build ratatui watch TUI
├── Build MCP server (JSON-RPC over stdio)
├── Build axum dojo server
└── Verify: all four presentation modes work

Phase 7: Distribution + Transition (1-2 sessions)
├── cargo install withkata
├── GitHub releases with cross-compiled binaries (x86_64, aarch64, Linux, macOS)
├── Homebrew formula
├── Deprecation notice on npm package
└── Migration guide (spoiler: replace the binary, everything else stays)
```

**Estimated total**: 17-24 sessions. With AI-assisted mechanical translation of domain/infra layers, the human-intensive work is concentrated in Phases 5-6 (~6-8 sessions).

---

## Rust Crate Dependencies

Core crates for the port. Prefer well-maintained, widely-adopted crates.

| Purpose | Crate | Replaces (TS) |
|---------|-------|---------------|
| CLI framework | `clap` (derive) | Commander.js |
| Serialization | `serde` + `serde_json` | Zod schemas + JSON.parse |
| Async runtime | `tokio` | Node.js event loop |
| TUI framework | `ratatui` + `crossterm` | blessed / ink |
| HTTP server (dojo) | `axum` | Express (if used) |
| Templating | `minijinja` or `askama` | String templates |
| Terminal colors | `owo-colors` or `colored` | chalk |
| Spinners/progress | `indicatif` | ora |
| Interactive prompts | `dialoguer` or `inquire` | inquirer / prompts |
| File watching | `notify` | chokidar |
| Graph database | `nanograph` (native crate) | `nanograph-db` (npm) |
| Error handling | `thiserror` + `anyhow` | Custom error hierarchy |
| Logging | `tracing` | Custom logger |
| Date/time | `chrono` | Date + luxon |
| UUID | `uuid` | uuid (npm) |
| Glob patterns | `globset` | glob (npm) |
| Testing | built-in `#[test]` + `rstest` | Vitest |
| Snapshot testing | `insta` | Vitest snapshots |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Domain model still changing when port starts | Medium | High | Gate: 3+ keiko cycles with no schema changes before starting |
| JSON compatibility breaks | Low | Critical | Phase 1 includes round-trip tests against TS-generated fixtures |
| Interactive TUI quality regression | Medium | Medium | Phase 6 is human-intensive; budget extra time for polish |
| nanograph Rust crate not ready | Medium | Low | KnowledgeStore trait allows JSON fallback; nanograph integration is additive |
| Port takes longer than estimated | Medium | Medium | Ship incrementally — Rust CLI can coexist with npm package |
| Contributor barrier increases | Low | Low | Single maintainer + AI agents; Rust's tooling (cargo, clippy, rustfmt) reduces friction |

---

## Success Criteria

The Rust port is complete when:

1. **All existing tests pass** in Rust (translated from the vitest suite).
2. **JSON round-trip compatibility**: `kata-rs` reads `.kata/` directories written by the TS version and vice versa.
3. **CLI parity**: every command, subcommand, flag, and alias works identically. `--json` output is byte-compatible.
4. **Performance targets met**: <10ms startup, <10MB memory baseline, <20MB binary size.
5. **Distribution works**: `cargo install withkata`, Homebrew, and GitHub release binaries all install and run correctly.
6. **MCP server functional**: agents can use kata resources without CLI round-trips.
7. **npm package deprecated** with migration guide pointing to Rust binary.

---

## Non-Goals for v3

- **Rewriting the domain model.** The port preserves existing architecture. Architectural improvements happen in v2 (TS) or v4 (Rust).
- **Adding new features.** v3 is a faithful port. New capabilities belong in v4.
- **WASM target.** Possible future direction but not in scope for the initial port.
- **Windows support.** macOS and Linux first. Windows is a fast-follow if there's demand.

---

## Prerequisites (Gate Criteria)

Do not begin the Rust port until all of these are true:

- [ ] v1 published to npm
- [ ] v2 features (strict enforcement, DAG pipelines, nanograph Phase 1-3) stable
- [ ] Domain model unchanged for 3+ consecutive keiko cycles
- [ ] MCP resource surface defined and stable in TS
- [ ] 50+ real keiko cycles completed (the domain model has been battle-tested)
- [ ] nanograph Rust crate >=1.0 (or decision to use JSON-only fallback)

---

*This is a vision document. It will be refined as v1 and v2 mature. The version strategy is sequential — ship TS, stabilize, port, retire.*
