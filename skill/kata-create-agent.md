# kata-create-agent — Registering a Kataka

> A kataka is a named agent persona with a role, skills, and an ID used to attribute runs.

---

## Manual Registration

```bash
kata agent register \
  --name "BuildBot" \
  --role executor \
  --skills "TypeScript,testing,CI" \
  --description "Runs build and review stages"
```

The command outputs the new kataka's UUID — save it as `KATAKA_ID`.

---

## Auto-Discovery via Init

```bash
kata init --discover-agents
```

Scans for:
- `*.agent.ts` / `*.agent.js` files
- `*.kataka.ts` / `*.kataka.js` files
- `## Agent: <Name>` or `## kataka: <Name>` declarations in `CLAUDE.md`

Registered agents appear in `.kata/KATA.md` under `## Kataka Registry` and in `.kata/kataka/*.json`.

---

## Listing Registered Kataka

```bash
kata agent list              # table view
kata agent list --json       # machine-readable
kata agent list --active     # only active kataka
```

**JSON output**:
```json
[
  {
    "id": "a1b2c3d4-...",
    "name": "BuildBot",
    "role": "executor",
    "skills": ["TypeScript", "testing"],
    "active": true,
    "createdAt": "2026-03-01T00:00:00.000Z"
  }
]
```

---

## Using Your Kataka ID

Pass `--kataka <id>` when running kiai to attribute the run:

```bash
export KATAKA_ID="a1b2c3d4-e5f6-7890-abcd-ef1234567890"
kata kiai build --kataka "$KATAKA_ID"
```

The ID is stored in stage artifact metadata and linked to observations.

---

## Deactivating and Removing

```bash
kata agent deactivate <id>   # sets active: false
kata agent delete <id>       # removes from registry
```
