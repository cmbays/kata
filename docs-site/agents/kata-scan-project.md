# kata-scan-project — Scanning a Project for Metadata

> `kata init --scan` collects project metadata without modifying any files.
> Use it before full `kata init` to inspect what would be detected, or to feed metadata into other tools.

---

## Running a Scan

```bash
kata init --scan basic   # package.json, git, project type
kata init --scan full    # basic + directory structure + file counts
```

Output is always JSON — no interactive prompts, no `.kata/` directory created.

---

## Basic Scan Output

```json
{
  "projectType": "node",
  "packageName": "my-app",
  "hasGit": true,
  "hasKata": false,
  "depth": "basic"
}
```

**`projectType` values**: `node`, `rust`, `go`, `python`, `unknown`

---

## Full Scan Output

```json
{
  "projectType": "node",
  "packageName": "my-app",
  "hasGit": true,
  "hasKata": false,
  "depth": "full",
  "directorySummary": {
    "src": 42,
    "test": 18,
    "docs": 7
  }
}
```

---

## Agent Use Cases

**Before onboarding**: scan to decide which methodology and adapter to recommend:

```bash
SCAN=$(kata init --scan full --json)
PROJECT_TYPE=$(echo "$SCAN" | jq -r '.projectType')
```

**Auto-init with scan**: chain scan → init for zero-interaction setup:

```bash
kata init --scan basic --json | jq .
kata init --skip-prompts --adapter claude-cli --discover-agents
```

---

## Discovering Agents at Init Time

```bash
kata init --discover-agents
```

After initialising, scans for agent-like files and `CLAUDE.md` declarations:
- `*.agent.ts` / `*.agent.js`
- `*.kataka.ts` / `*.kataka.js`
- `## Agent: <Name>` or `## kataka: <Name>` in any `CLAUDE.md`

Discovered agents are registered in `.kata/kataka/` and listed in `.kata/KATA.md`.

**JSON output** (when `--json` is set):
```json
{
  "kataDir": ".kata",
  "stagesLoaded": 12,
  "flavorsLoaded": 8,
  "agentDiscovery": {
    "discovered": 3,
    "registered": 3,
    "agents": [
      { "name": "BuildBot", "id": "...", "source": "src/agents/build.agent.ts" }
    ]
  }
}
```
