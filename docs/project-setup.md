# Project Setup — How You Set Up and Maintain a Kata Project

> KATA.md generation, init scanning, and the ongoing project context lifecycle.
>
> **Companion documents**:
> - [Kataka Architecture](kataka-architecture.md) — What kataka are (agent identity, wrapping, attribution)
> - [Sensei Orchestration](sensei-orchestration.md) — What the sensei does (execution, gap bridging)
> - [Kata System Guide](kata-system-guide.md) — How the system works today
> - [Implementation Roadmap](unified-roadmap.md) — KATA.md ships in Wave F, kataka scanning in Wave G

---

## KATA.md — Project Context File

A file at `.kata/KATA.md` that functions as CLAUDE.md for Kata specifically. Every kataka and sensei session is preloaded with this context.

### What It Contains

```markdown
# KATA.md — Kata Project Context

## Project
- Name: kata
- Stack: TypeScript, Next.js, Prisma, Tailwind
- Architecture: Clean architecture (domain → infra → features → CLI)

## Active Keiko
- Keiko: wave-ml-session-1
- Focus: Meta-learning observation data model
- Bets: core-observation-schema, learning-graph-index

## Kataka Registry
| Kataka           | Gyo      | Wraps             | Skills                        |
|------------------|----------|--------------------|-------------------------------|
| scout-ka         | research | —                  | scan-codebase                 |
| architect-ka     | plan     | —                  | design-architecture           |
| implementer-ka   | build    | frontend-builder   | tdd-workflow, api-conventions |
| auditor-ka       | review   | security-reviewer  | audit-security                |

## Project-Wide Bunkai
- Always use Zod v4 (`zod/v4` import path)
- ESM-only: all imports use `.js` extensions
- Tests colocated with source (*.test.ts)

## Methodology Preferences
- Confidence threshold: 0.7
- Approval mode: gate-based (not --yolo by default)
- Gap handling: note for cooldown (default), --bridge-gaps available
```

### How It's Generated

- `kata rei --scan` generates the initial `KATA.md` from project analysis
- `kata ma` can append project-wide bunkai discovered during reflection
- Manual edits are preserved on re-scan (sections marked `<!-- user -->` are protected)

### How It's Used

Every kataka definition includes `kata-orchestration` in its `skills:` field. The skill instructs the kataka to read `.kata/KATA.md` at startup. This is the DRY source of project context — no need to duplicate it across every kataka definition.

---

## Init Scanning Flow

`kata rei --scan` performs a full project capability assessment: detecting existing agents, skills, project type, framework conventions, and methodology fit. Kataka creation is one output of that broader scan.

### The Full Flow

```text
$ kata rei --scan full

  Scanning project capabilities...

  Project type: TypeScript / Node.js (detected from package.json)
  Framework: Express + Vitest (detected from dependencies)

  Found 2 agents:
    frontend-builder  → classified as: build gyo
    security-reviewer → classified as: review gyo

  Found 2 skills:
    tdd-workflow      → classified as: build gyo
    api-conventions   → classified as: build gyo

  Creating kataka:
    scout-ka          → research (default — no existing match)
    architect-ka      → plan (default — no existing match)
    implementer-ka    → build (wraps: frontend-builder, skills: tdd-workflow + api-conventions)
    auditor-ka        → review (wraps: security-reviewer)

  Generated: .kata/KATA.md
  Copied: 6 built-in skills to .claude/skills/kata-*/
  Ready for first kata run.
```

### Scan Modes

| Mode | Flag | Behavior |
|------|------|---------|
| Basic | `--scan basic` | Create default kataka for each gyo, no wrapping |
| Full | `--scan full` | Scan existing agents/skills, create wrappers, classify |
| Re-scan | `--scan resync` | Update existing kataka from changed source agents |

### Update Options

| Option | Behavior |
|--------|----------|
| `--scan full` (first run) | Creates new kataka, does not touch existing |
| `--scan full --overwrite` | Overwrites all kataka with fresh wrappers |
| `--scan resync` | Only updates kataka whose source agents have changed |
| `--scan full --additive` | Creates new kataka for newly discovered agents, keeps existing unchanged |

### Orphan Detection

During `--scan resync` and `--scan full`, the scanner checks for **orphaned kataka** — wrapper agents whose source has been removed:

```text
  Orphaned kataka detected:
    frontend-ka       → wraps: frontend-builder (agent file deleted)
    api-ka            → wraps: api-designer (agent file deleted)

  Options:
    [a] Archive — keep kataka but mark as unwrapped (preserve kansatsu history)
    [d] Delete — remove kataka definition
    [s] Skip — leave unchanged for now
```

### Classification

The LLM classifies existing agents and skills by analyzing:
- Agent name and description
- Tool restrictions (read-only → research/review, full write → build)
- Preloaded skills and their content
- System prompt keywords and intent

Classification is recorded as a kime with confidence. Low-confidence classifications are flagged for human review.

---

*See [Kataka Architecture](kataka-architecture.md) for agent identity and wrapping mechanics, [Implementation Roadmap](unified-roadmap.md) for sequencing.*
