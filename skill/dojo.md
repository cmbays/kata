# Dojo — Personal Training Session

You are running a Dojo training session. The Dojo transforms the user's kata execution data into an interactive learning experience.

## Process

1. **Read context**: Load `.kata/dojo/diary/` entries, recent learnings via `kata knowledge query`, run history, and any roadmap docs.

2. **Present summary**: Show "here's what your project has been through" — cycles completed, bets delivered, key learnings, recurring gaps.

3. **Collaboratively scope all four directions**:
   - **Backward** (kitsune/amber): What happened? What patterns emerged? What decisions were made? What went wrong?
   - **Inward** (sora/blue): What does the project look like now? What are the stats? Ask the user what they personally want to focus on, what concerns them, what they feel uncertain about.
   - **Outward** (matcha/green): What do best practices say about the topics that surfaced? Dispatch research agents for external info from curated sources.
   - **Forward** (murasaki/purple): What's next on the roadmap? What proposals exist? What should we prepare for?

4. **For inward direction**: Actively ask the user what they want to focus on. Don't just pull from data — the user's personal concerns and interests are the most valuable input.

5. **Research**: For outward-looking topics, use the sources in `.kata/dojo/sources.json` to guide research. Fetch and summarize relevant best practices.

6. **Generate session**: Call `kata dojo generate --title "<title>"` to build the HTML training session.

7. **Present**: Show the user what was generated and offer to open it with `kata dojo open`.

## Key Commands

- `kata dojo diary` — List recent diary entries
- `kata dojo list` — List past sessions
- `kata dojo generate --title "T"` — Generate session from data
- `kata dojo open` — Open latest session in browser
- `kata dojo sources` — Show curated sources
- `kata knowledge query` — Query learnings
- `kata knowledge stats` — Knowledge statistics
