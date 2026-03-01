# kata-create-skill — Writing a Kata Skill File

> Skill files are markdown documents in `skill/` (repo root) or `.kata/skill/` (project).
> They are loaded into agent context via `kata init` and updated with each new release.

---

## File Location and Naming

```
skill/                          # repo-level (shipped with kata)
  kata-create-skill.md          # this file
  orchestration.md              # agent orchestration guide
  ...
.kata/skill/                    # project-level copy (auto-copied by kata init)
```

Name your file descriptively: `skill/kata-<topic>.md` for kata-specific skills, or `skill/<domain>-<topic>.md` for project-specific skills.

---

## Structure

A skill file should contain:

1. **Title + one-line purpose** — `# skill-name — What this skill does`
2. **Concept mapping table** — domain terms → what they mean in this context
3. **How-to sections** — concrete commands, patterns, examples with code blocks
4. **Reference tables** — flags, fields, schemas
5. **Edge cases** — what to do when things go wrong

---

## Minimal Template

```markdown
# kata-my-topic — What This Skill Covers

> One-line description.

---

## Core Concepts

| Term | Meaning |
|------|---------|
| ... | ... |

---

## How to ...

\`\`\`bash
kata ...
\`\`\`

---

## Reference

| Flag | Description |
|------|-------------|
| ... | ... |
```

---

## Adding to Navigation

After creating a skill file, add it to `docs.json` under the appropriate group:

```json
{
  "group": "For Agents",
  "pages": [
    "skill/orchestration",
    "skill/kata-create-skill"
  ]
}
```

(Drop the `.md` extension — Mintlify resolves it automatically.)

---

## Testing Your Skill File

Skill files have no automated tests. Validate manually:
- All CLI commands shown actually exist (`kata --help`)
- JSON examples match real `--json` output
- Links to other skill files use relative paths
