# Breadboarding Stage

## Purpose

Map the selected shape as an interaction model using places, affordances, and wiring. Define vertical slices that enable incremental delivery. The breadboard is the blueprint that connects shaping decisions to implementation planning.

Breadboarding reveals the actual complexity of a solution by forcing you to name every interactive element and trace every connection. If you cannot name it specifically, you do not understand the design yet.

## Expected Inputs

- **shaping-doc** artifact from the Shaping stage
- Understanding of the selected shape, its parts, and architecture
- Research and interview context for reference

## Process

### Step 1: Identify Places

A **Place** is a bounded context where specific affordances become available. Apply the **blocking test**: if you cannot interact with elements behind something, you have entered a different Place.

1. **List all places** the user will encounter
2. **Use hierarchical IDs**: P1, P2, P2.1, P2.2, P3
3. **Apply the blocking test** to each:
   - Different page/route = new Place
   - Modal dialog = new Place (P2.1 inside P2)
   - Accordion/dropdown/tab = NOT a new Place (local state change)
4. **Include a Backend place** if the system has persistence or APIs

For CLI applications:
- Interactive prompt sequences = Places (block until answered)
- Non-interactive commands (print and return) = affordances within the Shell place

| # | Place | Description |
|---|-------|-------------|
| P1 | [Name] | [Description] |
| P2 | [Name] | [Description] |

### Step 2: Map UI Affordances (U)

Things users **see and interact with**. These are tangible entry points into the system.

For each Place, list all interactive elements:

| # | Place | Component | Affordance | Control | Wires Out | Returns To |
|---|-------|-----------|------------|---------|-----------|------------|
| U1 | P1 | [component] | [specific name] | [click/type/select/render] | [what it triggers] | [where results feed] |

**Naming rules**:
- Name actual things: "Customer Combobox", "Save as Draft button", "Status filter tabs"
- NOT abstractions: "search input", "secondary action", "filter mechanism"
- If you cannot name it specifically, go back to the shaping document

**NOT UI affordances** (these are layout/decoration):
- Section headings, static labels, separator lines, background colors

### Step 3: Map Code Affordances (N)

Functions, handlers, and computations that execute when triggered:

| # | Place | Component | Affordance | Control | Wires Out | Returns To |
|---|-------|-----------|------------|---------|-----------|------------|
| N1 | P7 | [service] | `functionName(args)` | call | [what it triggers] | [where output goes] |

**Rules**:
- Every N must have a trigger (something that activates it)
- Skip framework internals (routing, reconciliation) — wire directly to destinations
- Side effects need stores: if N writes to URL/localStorage/external state, create a Store

### Step 4: Map Data Stores (S)

State that persists and gets read/written:

| # | Place | Store | Description | Written By | Read By |
|---|-------|-------|-------------|------------|---------|
| S1 | P7 | [store name] | [what it holds] | [which N writes] | [which N reads] |

**Placement rule**: A store belongs in the Place where its data is consumed to enable some effect — not where it is produced.

### Step 5: Wire Everything

Trace the connections:

1. **Wires Out (Control Flow)**: What an affordance triggers when activated
2. **Returns To (Data Flow)**: Where an affordance's output feeds

Verify:
- Every U connects to something (otherwise it is decorative, not an affordance)
- Every N has a trigger
- No dangling wires (every reference target exists)

### Step 6: Define Vertical Slices

Cut the breadboard into demo-able increments:

1. Each slice must show **observable changes** — something the user can see or interact with
2. Order by **dependency** — build what others depend on first
3. Shared components come first — they unblock multiple slices
4. A slice may wire to future slices — show the wire, note it is not yet implemented

| # | Slice | Parts | Key Affordances | Demo |
|---|-------|-------|-----------------|------|
| V1 | [Name] | [Which parts] | [Which affordances] | "[What you can demonstrate]" |

### Step 7: Quality Check

Verify the breadboard:

- [ ] Every Place passes the blocking test
- [ ] Every requirement from shaping has corresponding affordances
- [ ] Every U has at least one Wires Out or Returns To
- [ ] Every N has a trigger and either Wires Out or Returns To
- [ ] Every S has at least one reader and one writer
- [ ] No dangling wire references
- [ ] Slices are defined with demo statements
- [ ] All code affordances pass the one-verb naming test

## Output Format

Produce a **breadboard-doc** artifact with this structure:

```markdown
# Breadboard: [Feature/Project Name]

## Places

| # | Place | Description |
|---|-------|-------------|
| P1 | ... | ... |

## UI Affordances

### P1: [Place Name]

| # | Place | Component | Affordance | Control | Wires Out | Returns To |
|---|-------|-----------|------------|---------|-----------|------------|

### P2: [Place Name]
[Same table format]

## Code Affordances

### [Component Group]

| # | Place | Component | Affordance | Control | Wires Out | Returns To |
|---|-------|-----------|------------|---------|-----------|------------|

## Data Stores

| # | Place | Store | Description | Written By | Read By |
|---|-------|-------|-------------|------------|---------|

## Vertical Slices

| # | Slice | Parts | Key Affordances | Demo |
|---|-------|-------|-----------------|------|

### Slice Dependencies
[Dependency diagram or description]

## Quality Gate
- [ ] [All quality checks from Step 7]
```

## Quality Criteria

The breadboard is complete when:

- [ ] All places are identified and pass the blocking test
- [ ] All UI and code affordances are named specifically (not abstractly)
- [ ] All wiring is traced with no dangling references
- [ ] Data stores are placed in consuming contexts
- [ ] Vertical slices cover the full breadboard
- [ ] Each slice has a concrete demo statement
- [ ] Slice dependency order is defined
- [ ] The breadboard is detailed enough for implementation planning without re-designing
