# Dojo Architecture — Personal Training Environment

> How the Dojo transforms Kata's execution data into an interactive training experience for the developer — diary entries, session generation, the Japanese dojo design system, and the curated source registry.
>
> **Companion documents**:
> - [Kata System Guide](kata-system-guide.md) — Overview hub for the whole system
> - [Meta-Learning Architecture](meta-learning-architecture.md) — The observation and knowledge systems that feed the Dojo
> - [Implementation Roadmap](unified-roadmap.md) — Wave K (shipped) built the Dojo
>
> **Implementation status**: Wave K shipped (PR #172, 2026-02-28). All core features are implemented and tested.

---

## Core Idea

Kata captures rich kiai (execution) data — kime (decisions), bunkai (learnings), frictions, run state, ma (cooldown) reflections — but primarily serves the system's self-improvement loop. The Dojo flips this: it transforms that same data into an interactive training experience for the *developer*.

Each Dojo session is an **emergent, fit-for-the-moment** HTML experience — not a static knowledge base. Sessions are generated through conversation with Claude, saved for later review, and build up a personal training archive.

---

## 1. Four Knowledge Directions

Every Dojo session covers all four directions, ensuring a complete picture. Like other Kata concepts, directions have both plain English names and Japanese martial arts aliases — the thematic names are used by default, with `--plain` mode showing English equivalents.

| Direction | Alias | Kanji | Color | What it covers | Data sources |
|-----------|-------|-------|-------|---------------|-------------|
| **Backward** | **ushiro** | 後ろ | Kitsune (amber/gold) | What happened, what worked, what didn't | Diary entries, run summaries, decision outcomes, bet results |
| **Inward** | **uchi** | 内 | Sora (sky blue) | Current project state, personal focus areas | Knowledge stats, flavor frequency, user reflections, confidence distribution |
| **Outward** | **soto** | 外 | Matcha (green) | Industry best practices for your stack | Curated external sources, research agent findings |
| **Forward** | **mae** | 前 | Murasaki (purple) | What's next, what to prepare for | Proposals, roadmap items, open questions from diaries |

The aliases come from karate directional vocabulary: ushiro-geri (back kick), mae-geri (front kick), uchi-uke (inside block), soto-uke (outside block). They pair naturally — ushiro/mae (behind/front), uchi/soto (inside/outside).

The four directions are not just organizational — they represent fundamentally different types of learning. Ushiro is reflective. Uchi is introspective. Soto is comparative. Mae is preparatory.

---

## 2. Two Entry Points

### Conversational: `/dojo` Skill

Inside a Claude session, the `/dojo` skill drives collaborative session creation:

1. Read `.kata/dojo/diary/` entries, recent bunkai (learnings), run history, roadmap
2. Present "here's what your project has been through" summary
3. **Collaboratively scope all four directions:**
   - Ushiro (backward): What happened? What patterns emerged? What went wrong?
   - Uchi (inward): What does the project look like now? What does the *user* personally want to focus on? What concerns them?
   - Soto (outward): What do best practices say about the topics that surfaced?
   - Mae (forward): What's next on the roadmap? What should we prepare for?
4. Dispatch research kataka (agents) for soto topics
5. Generate session HTML
6. Present the result

The uchi direction is deliberately interactive — Claude actively asks the user what they want to focus on, what concerns them, what they feel uncertain about. This is not just data aggregation; it's a conversation.

### CLI: `kata dojo`

Outside Claude, the CLI is an archive viewer for revisiting past sessions:

```
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

**Interactive (default):** Claude writes the narrative during ma (cooldown) with the user present. The ma skill instructs Claude to reflect on the keiko and produce a rich narrative — capturing the emotional texture, surprises, and breakthroughs that structured data alone can't convey. Claude can ask the user directly: "What surprised you?", "What are you worried about?", "What felt like a breakthrough?" The user's voice is the richest input.

**Autonomous (`--auto`):** Claude runs ma without user interaction. Claude still has full LLM capability — it can read run data, infer patterns, identify what went well and what didn't, assess mood from structured signals, and write a qualitative narrative. What's missing is the user's personal perspective: their emotional state, their concerns, what felt important to *them* vs. what the data shows. Claude should still make judgment calls — inferring mood from outcome patterns, identifying likely pain points from gap severity, surfacing open questions from unfinished work — it just can't validate those inferences with the user.

**Deterministic (no Claude):** Pure template-based generation from structured data when no LLM is available at all (e.g., offline environments, CI pipelines). This is the true fallback:
- Narrative: "Keiko '{name}' completed with X/Y bets..."
- Wins: From complete bet outcomes
- Pain points: From partial/abandoned bets + high-severity gaps
- Open questions: From proposals
- Mood: Heuristic (>80% bets complete = energized, 50-80% = steady, <50% = frustrated)

> **Current state**: The interactive and deterministic tiers are implemented. The autonomous tier currently falls through to deterministic — enhancing `--auto` to use Claude's inference capability for richer unattended diary entries is tracked as a follow-up ([#180](https://github.com/cmbays/kata/issues/180)).

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

### Topics

Each topic has a direction (backward/inward/outward/forward), priority, and description. Topics are scoped collaboratively during the `/dojo` conversation — Claude proposes them based on data, the user refines and prioritizes.

### Content Sections

Sections are the building blocks of the rendered HTML. Each has a type that determines rendering:

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

```
DataAggregator ──> SessionBuilder ──> HtmlGenerator ──> SessionStore
     │                   │                  │                │
  Gathers data     Orchestrates       Pure function:     Saves meta.json
  from kata        section gen        Session → HTML     + session.html
  stores           per topic                             + updates index
```

**DataAggregator** bridges kata's structured data and the Dojo. Returns a `DojoDataBundle`:
- Ushiro: recent diaries, keiko, run summaries, top bunkai (learnings), recurring gaps
- Uchi: bunkai stats, ryu (flavor) frequency
- Metadata: project name, total keiko, total runs

Reuses existing services: `CycleManager.list()`, `KnowledgeStore.query()/stats()`, cross-run-analyzer's `analyzeFlavorFrequency()`/`analyzeRecurringGaps()`.

**SessionBuilder** generates sections by direction:
- Ushiro (backward): Timeline, kime quality charts, gap recurrence, bet outcome trends
- Uchi (inward): Bunkai stats, ryu frequency, confidence distribution
- Soto (outward): Research findings from curated sources
- Mae (forward): Proposals reframed as learning objectives, open questions

**HtmlGenerator** is a pure function: `DojoSession → HTML string`. All CSS/JS inlined. No external runtime dependencies.

---

## 5. Design System — Japanese Dojo Theme

Sessions render as self-contained HTML files with a cohesive Japanese dojo aesthetic.

### Technology

- **Tailwind CSS** via inlined CDN play script — AI writes excellent Tailwind utility classes consistently
- **Design language** inspired by shadcn/ui patterns (card surfaces, muted backgrounds, clean borders) but implemented as plain Tailwind — no React dependency
- **Charts**: Inline SVG generated server-side via `design-system.ts` utilities
- **All self-contained**: No external dependencies at runtime. Sessions are single HTML files that render anywhere.

### Color Palette

| Token | Color | Usage |
|-------|-------|-------|
| **Ink** | Deep indigo/sumi-ink | Primary text |
| **Washi** | Warm off-white | Paper-texture backgrounds |
| **Aka** | Torii gate red | Emphasis, alerts |
| **Matcha** | Green | Success, growth, soto (outward) direction |
| **Sora** | Sky blue | Info, uchi (inward) direction |
| **Kitsune** | Amber/gold | Ushiro (backward) direction |
| **Murasaki** | Purple | Mae (forward) direction |

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
| `domains` | string[] | Tech domains covered (e.g., "typescript", "security") |
| `reputation` | enum | official / authoritative / community / experimental |
| `description` | string? | |
| `active` | boolean | Toggle for inclusion in research |

### Default Sources

Shipped as `dojo/default-sources.json` with curated defaults per common domain: official language docs, MDN, OWASP, framework documentation, etc. Projects inherit these at `kata rei` (init) and can add/remove/toggle sources via `kata dojo sources`.

### Research Kataka

During a `/dojo` session, Claude dispatches research kataka (agents) guided by `skill/dojo-research.md` to:
1. Read `sources.json` for their search scope
2. Fetch information relevant to the scoped topics from those sources
3. Validate findings against internal project data (pain points, bunkai, gaps)
4. Summarize and structure findings for session consumption

Research kataka prioritize official/authoritative sources, check recency, and score relevance to the specific project context.

---

## 7. Ma (Cooldown) Integration

The Dojo integrates into the existing ma flow with minimal, non-breaking changes.

### How It Works

After ma step 8 (capture bunkai), before step 9 (transition to complete):
1. `DiaryStore` created from `.kata/dojo/diary/` path
2. `DiaryWriter.writeDiary()` called with ma data
3. Diary entry saved as `{keiko-id}.json`
4. Wrapped in try/catch — diary failure **never** aborts ma

### What Feeds In

The DiaryWriter receives:
- Keiko (cycle) ID and name
- Narrative (from Claude, or generated from templates)
- Bet outcomes (complete/partial/abandoned)
- Proposals for next keiko
- Run summaries (gyo, gaps, kime)
- Bunkai captured during this ma
- Rule suggestions

---

## 8. Directory Structure

```
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

The Dojo is a **consumer** of meta-learning data — it reads whatever exists and works with the current data model. No code changes needed in Waves F–J for the Dojo.

| Wave | What the Dojo gains |
|------|-------------------|
| **F** | Kansatsu (observation) data enriches diary entries and session content |
| **H** | Frictions become prime diary content; prediction calibration feeds ushiro direction |
| **I** | LLM synthesis could replace template-based section generation (v2 upgrade path) |
| **J** | Belt data feeds a "progress" section type |

---

## v1 Scope Boundary

**Shipped**: Diary entries (interactive + deterministic tiers), data aggregation, session building with all four directions, self-contained HTML with Tailwind CSS + Japanese dojo theme + inline SVG charts, CLI archive viewer, skill files, curated source registry, dark/light mode, progressive disclosure.

**Follow-up**: Autonomous diary tier (`--auto` with LLM inference) — currently falls through to deterministic.

**v2+**: Spaced repetition scheduling, active recall quizzing, review/synthesis sessions across multiple past sessions, Mermaid pre-rendering to SVG, contextual injection into regular workflow, rich app experience (dev server/React), belt progression integration, session search/filtering, session diffing.

---

*Last updated: 2026-02-28. Wave K shipped (PR #172). See [Kata System Guide](kata-system-guide.md) for how the Dojo fits into the broader system.*
