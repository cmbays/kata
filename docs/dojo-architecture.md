# Dojo Architecture — Personal Training Environment

> How the Dojo transforms Kata's execution data into an interactive training experience for the developer — diary entries, session generation, the Japanese dojo design system, and the curated source registry.
>
> **Companion documents**:
> - [Kata System Guide](kata-system-guide.md) — Overview hub for the whole system
> - [Meta-Learning Architecture](meta-learning-architecture.md) — The observation and knowledge systems that feed the Dojo
> - [Implementation Roadmap](unified-roadmap.md) — Wave K built the Dojo

---

## Core Idea

Kata captures rich kiai (execution) data — kime (decisions), bunkai (learnings), frictions, run state, ma (cooldown) reflections — but primarily serves the system's self-improvement loop. The Dojo flips this: it transforms that same data into an interactive training experience for the *developer*.

Each Dojo session is an **emergent, fit-for-the-moment** HTML experience — not a static knowledge base. Sessions are generated through conversation with Claude, saved for later review, and build up a personal training archive.

---

## 1. Four Knowledge Directions

Every Dojo session covers all four directions, ensuring a complete picture. Directions have both plain English names and Japanese martial arts aliases — the thematic names are used by default, with `--plain` mode showing English equivalents.

| Direction | Alias | Kanji | Color | What it covers | Data sources |
|-----------|-------|-------|-------|---------------|-------------|
| **Backward** | **ushiro** | 後ろ | Kitsune (amber/gold) | What happened, what worked, what didn't | Diary entries, run summaries, kime outcomes, bet results |
| **Inward** | **uchi** | 内 | Sora (sky blue) | Current project state, personal focus areas | Bunkai stats, ryu frequency, user reflections, confidence distribution |
| **Outward** | **soto** | 外 | Matcha (green) | Industry best practices for your stack | Curated external sources, research agent findings |
| **Forward** | **mae** | 前 | Murasaki (purple) | What's next, what to prepare for | Proposals, roadmap items, open questions from diaries |

The aliases come from karate directional vocabulary: ushiro-geri (back kick), mae-geri (front kick), uchi-uke (inside block), soto-uke (outside block).

---

## 2. Two Entry Points

### Conversational: `/dojo` Skill

Inside a Claude session, the `/dojo` skill drives collaborative session creation:

1. Read `.kata/dojo/diary/` entries, recent bunkai, run history, roadmap
2. Present "here's what your project has been through" summary
3. **Collaboratively scope all four directions:**
   - Ushiro: What happened? What patterns emerged? What went wrong?
   - Uchi: What does the project look like now? What does the *user* want to focus on?
   - Soto: What do best practices say about the topics that surfaced?
   - Mae: What's next on the roadmap? What should we prepare for?
4. Dispatch research kataka (agents) for soto topics
5. Generate session HTML
6. Present the result

The uchi direction is deliberately interactive — Claude actively asks the user what they want to focus on.

### CLI: `kata dojo`

Outside Claude, the CLI is an archive viewer for revisiting past sessions:

```bash
kata dojo list                   # Session archive table
kata dojo open [session-id]      # Open in browser (latest if omitted)
kata dojo inspect <session-id>   # Session details in terminal
kata dojo diary [-n count]       # List recent diary entries
kata dojo diary write <cycle-id> # Write a diary entry (Claude uses this during cooldown)
kata dojo sources                # Show curated source registry
kata dojo generate               # Generate session from recent data (non-interactive)
```

All commands respect `--json` and `--plain` flags.

---

## 3. Diary Entries — The Bridge

Diary entries are the bridge between Kata's structured data and the conversational Dojo experience. After each ma (cooldown), a diary entry captures the narrative of the keiko (cycle).

### Schema: `DojoDiaryEntrySchema`

| Field | Type | Purpose |
|-------|------|---------|
| `id` | UUID | |
| `cycleId` | UUID | Links to the keiko this reflects on |
| `cycleName` | string? | Display name |
| `narrative` | string | Free-form: what happened, surprises, breakthroughs |
| `wins` | string[] | Key accomplishments |
| `painPoints` | string[] | Frustrations, blockers |
| `openQuestions` | string[] | Seeds for future Dojo sessions |
| `mood` | enum? | energized / steady / frustrated / reflective / uncertain |
| `tags` | string[] | Topic indexing |
| `createdAt` | datetime | |

### Three Writing Tiers

Diary quality scales with the level of interaction available. All three tiers produce valid diary entries — the difference is narrative richness.

**Interactive (default):** Claude writes the narrative during ma with the user present. Claude can ask directly: "What surprised you?", "What are you worried about?", "What felt like a breakthrough?" The user's voice is the richest input.

**Autonomous (`--auto`):** Claude runs ma without user interaction. Claude reads run data, infers patterns, identifies what went well and what didn't, assesses mood from structured signals, and writes a qualitative narrative. What's missing is the user's personal perspective. Enhancing `--auto` to use Claude's inference capability for richer unattended diary entries is tracked as [#180](https://github.com/cmbays/kata/issues/180).

**Deterministic (no Claude):** Pure template-based generation from structured data when no LLM is available (offline environments, CI pipelines):
- Narrative: "Keiko '{name}' completed with X/Y bets..."
- Wins: From complete bet outcomes
- Pain points: From partial/abandoned bets + high-severity gaps
- Open questions: From proposals
- Mood: Heuristic (>80% bets complete = energized, 50-80% = steady, <50% = frustrated)

---

## 4. Sessions — The Training Experience

### Session Schema

| Field | Type | Purpose |
|-------|------|---------|
| `id` | UUID | |
| `title` | string | Human-readable session title |
| `summary` | string | 1-2 sentence overview |
| `topics` | DojoTopic[] | Focus areas scoped during conversation |
| `sections` | DojoContentSection[] | Ordered rendered content |
| `diaryEntryIds` | UUID[] | Which diary entries informed this |
| `runIds` | UUID[] | Which runs informed this |
| `cycleIds` | UUID[] | Which keiko informed this |
| `sourceIds` | UUID[] | Which external sources were used |
| `tags` | string[] | |
| `createdAt` | datetime | |
| `version` | literal(1) | For format evolution |

### Content Sections

Sections are the building blocks of the rendered HTML:

| Type | Rendering |
|------|-----------|
| `narrative` | Prose markdown |
| `checklist` | Interactive checkbox list |
| `comparison` | Side-by-side table |
| `timeline` | Chronological event sequence |
| `diagram` | Mermaid syntax code block |
| `chart` | Inline SVG (bar, sparkline, donut) |
| `code` | Syntax-highlighted code block |
| `quiz` | Interactive Q&A |
| `reference` | External link collection |

Sections support progressive disclosure (`collapsed: boolean`) and nesting (`depth: number`).

### Generation Pipeline

```text
DataAggregator ──> SessionBuilder ──> HtmlGenerator ──> SessionStore
     │                   │                  │                │
  Gathers data     Orchestrates       Pure function:     Saves meta.json
  from kata        section gen        Session → HTML     + session.html
  stores           per topic                             + updates index
```

**DataAggregator** bridges kata's structured data and the Dojo. Returns a `DojoDataBundle`:
- Ushiro: recent diaries, keiko, run summaries, top bunkai, recurring gaps
- Uchi: bunkai stats, ryu frequency
- Metadata: project name, total keiko, total runs

**SessionBuilder** generates sections by direction:
- Ushiro: Timeline, kime quality charts, gap recurrence, bet outcome trends
- Uchi: Bunkai stats, ryu frequency, confidence distribution
- Soto: Research findings from curated sources
- Mae: Proposals reframed as learning objectives, open questions

**HtmlGenerator** is a pure function: `DojoSession → HTML string`. All CSS/JS inlined. No external runtime dependencies.

---

## 5. Design System — Japanese Dojo Theme

Sessions render as self-contained HTML files with a cohesive Japanese dojo aesthetic.

### Technology

- **Tailwind CSS** via inlined CDN play script
- **Design language** inspired by shadcn/ui patterns but implemented as plain Tailwind — no React dependency
- **Charts**: Inline SVG generated server-side via `design-system.ts` utilities
- **All self-contained**: No external dependencies at runtime

### Color Palette

| Token | Color | Usage |
|-------|-------|-------|
| **Ink** | Deep indigo/sumi-ink | Primary text |
| **Washi** | Warm off-white | Paper-texture backgrounds |
| **Aka** | Torii gate red | Emphasis, alerts |
| **Matcha** | Green | Success, growth, soto direction |
| **Sora** | Sky blue | Info, uchi direction |
| **Kitsune** | Amber/gold | Ushiro direction |
| **Murasaki** | Purple | Mae direction |

Dark mode: deep sumi-ink backgrounds with muted versions of the palette.

### Layout

- **Header**: Session title with thin red accent line, date, topic count
- **Sticky nav sidebar**: Direction sections color-coded, collapsible topic groups
- **Main content**: Card-based sections with direction color accents on left border
- **Progressive disclosure**: `<details>/<summary>` with smooth transitions
- **Print-friendly**: `@media print` styles for clean output

### SVG Chart Utilities (`design-system.ts`)

Small functions that return raw SVG strings styled to match the dojo theme:
- `barChart()` — Vertical bar charts for comparisons
- `sparkline()` — Compact trend lines
- `donutChart()` — Proportional breakdowns
- `horizontalBar()` — Progress/comparison bars

---

## 6. Source Registry — Curated External Knowledge

The source registry provides the scope for outward-looking research.

### Schema

| Field | Type | Purpose |
|-------|------|---------|
| `id` | UUID | |
| `name` | string | Display name (e.g., "TypeScript Handbook") |
| `url` | URL | Base URL |
| `domains` | string[] | Tech domains covered |
| `reputation` | enum | official / authoritative / community / experimental |
| `description` | string? | |
| `active` | boolean | Toggle for inclusion in research |

### Default Sources

Provided as `dojo/default-sources.json` with curated defaults per common domain: official language docs, MDN, OWASP, framework documentation, etc. Projects inherit these at `kata rei` (init) and can add/remove/toggle sources via `kata dojo sources`.

### Research Kataka

During a `/dojo` session, Claude dispatches research kataka guided by `skill/dojo-research.md` to fetch, validate, and structure findings from registered sources.

---

## 7. Ma (Cooldown) Integration

The Dojo integrates into the existing ma flow with minimal, non-breaking changes.

### How It Works

After ma step 6 (capture bunkai), before the transition to complete:
1. `DiaryStore` created from `.kata/dojo/diary/` path
2. `DiaryWriter.writeDiary()` called with ma data
3. Diary entry saved as `{keiko-id}.json`
4. Wrapped in try/catch — diary failure **never** aborts ma

### What Feeds In

The DiaryWriter receives: keiko ID and name, narrative, bet outcomes, proposals, run summaries, bunkai captured during this ma, and rule suggestions.

---

## 8. Directory Structure

```text
.kata/dojo/
  diary/                           # One JSON file per ma (cooldown)
    {keiko-id}.json                # DojoDiaryEntry
  sessions/                        # Generated sessions
    {session-id}/
      meta.json                    # DojoSessionMeta (lightweight index data)
      session.html                 # Self-contained interactive HTML
  sources.json                     # Curated external source registry
  index.json                       # Session archive index (rebuilt from meta files)
```

Created at `kata rei` (init). Session store maintains the index; `rebuildIndex()` repairs it from session directories if needed.

---

## 9. Integration with Meta-Learning

The Dojo is a **consumer** of meta-learning data — it reads whatever exists and works with the current data model. No code changes needed for the Dojo as meta-learning waves ship.

| What the Dojo gains | Source |
|---------------------|--------|
| Kansatsu data enriches diary entries and session content | [Wave F](unified-roadmap.md) |
| Frictions become prime diary content; prediction calibration feeds ushiro direction | [Wave H](unified-roadmap.md) |
| LLM synthesis could replace template-based section generation (v2 upgrade path) | [Wave I](unified-roadmap.md) |
| Belt data feeds a "progress" section type | [Wave J](unified-roadmap.md) |

---

## v1 Scope Boundary

**Built**: Diary entries (interactive + deterministic tiers), data aggregation, session building with all four directions, self-contained HTML with Tailwind CSS + Japanese dojo theme + inline SVG charts, CLI archive viewer, skill files, curated source registry, dark/light mode, progressive disclosure.

**Follow-up**: Autonomous diary tier (`--auto` with LLM inference) — [#180](https://github.com/cmbays/kata/issues/180).

**v2+**: Spaced repetition scheduling, active recall quizzing, review/synthesis sessions across multiple past sessions, Mermaid pre-rendering to SVG, contextual injection into regular workflow, rich app experience (dev server/React), belt progression integration, session search/filtering, session diffing.

---

*See [Kata System Guide](kata-system-guide.md) for how the Dojo fits into the broader system.*
