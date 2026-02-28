## Unreleased

### Bug Fixes

- Harden Wave 3 — path traversal, outcome validation, rollback, dead code
- Review fixes — port interfaces, dedup StageFilter, init dirs, hook perms
- Post-PR#90 quick wins — execute tests, review fixes, infra hardening
- Wave A Session 1 pre-Session-2 cleanup ([#111](https://github.com/cmbays/kata/issues/111)) ([#115](https://github.com/cmbays/kata/issues/115))
- Correct --json flag placement note and add to all examples in cli-reference.md
- *([#123](https://github.com/cmbays/kata/issues/123))* Resolve prompt template path relative to stagesDir not kataDir

### Chores

- Formalize public repo — LICENSE, badges, gitignore, topics
- *(docs)* Initialize Mintlify site — linden theme, full navigation

### Documentation

- Copy pipeline artifacts from print-4ink, update paths
- Add methodology reference material from print-4ink
- Add v1 design vision — three-tier execution hierarchy ([#57](https://github.com/cmbays/kata/issues/57))
- V1 product specification — complete product vision, user stories, and architecture ([#110](https://github.com/cmbays/kata/issues/110))
- Add Wave C S2+S3+S4 shaping and breadboard workspace artifacts ([#132](https://github.com/cmbays/kata/issues/132))
- Kataka architecture — agents, skills, and methodology-aware AI ([#154](https://github.com/cmbays/kata/issues/154))
- Unified roadmap (Waves F-J) merging Kataka + Meta-Learning ([#155](https://github.com/cmbays/kata/issues/155))
- DRY overhaul — themed-first vocabulary, industry-standard doc patterns ([#179](https://github.com/cmbays/kata/issues/179))
- Add changelog and contributing; add changelog:generate script

### Features

- Wave 0 foundation — types, persistence, CLI skeleton, tests
- Wave 1 services — registries, cycle management, knowledge, adapters
- Wave 2 application layer — CLI commands, formatters, pipeline runner
- Wave 3 intelligence — self-improvement loop, cooldown proposals
- Wave 4 polish — integration tests, lint config, error handling, hardening
- Add CI pipeline and pre-commit hooks
- Wave 4 polish — CI, tests, naming, ports, review fixes
- Wave 5 Priority Now — fix #3 #4 #5 #8
- Gate async refactor, command-passes condition, lifecycle hooks (#9 #10 #11) ([#21](https://github.com/cmbays/kata/issues/21))
- Add test/security-audit/deploy stages and post-init guidance (#12 #13) ([#22](https://github.com/cmbays/kata/issues/22))
- ClaudeCliAdapter -w isolation, AO config gen, dual budget tracking (#23 #24)
- Tech-stack stage flavors — build & review variants ([#14](https://github.com/cmbays/kata/issues/14))
- Kata stage create — interactive scaffolding, resource schema, builtin stages ([#16](https://github.com/cmbays/kata/issues/16))
- Stage Authoring V1 — wizard, field-menu, checkbox, delete, rename (#28 round 2) ([#30](https://github.com/cmbays/kata/issues/30))
- Introduce StageCategory enum and Stage schema ([#37](https://github.com/cmbays/kata/issues/37))
- Flavor as first-class composition entity ([#63](https://github.com/cmbays/kata/issues/63))
- Add Decision schema, port interface, and registry ([#38](https://github.com/cmbays/kata/issues/38)) ([#71](https://github.com/cmbays/kata/issues/71)) ([#72](https://github.com/cmbays/kata/issues/72))
- Implement Stage Orchestrator — v1 intelligence layer ([#40](https://github.com/cmbays/kata/issues/40))
- Builtin Steps + Flavors + kata kiai execute command ([#75](https://github.com/cmbays/kata/issues/75))
- V1 orchestration engine evolution ([#88](https://github.com/cmbays/kata/issues/88))
- CLI + lexicon realignment (issue #89) ([#90](https://github.com/cmbays/kata/issues/90))
- Wave A Session 1 — run state infrastructure + agent CLI commands (#94, #97, #98, #108, #109) ([#114](https://github.com/cmbays/kata/issues/114))
- Wave A Session 2 — cycle betting, run creation, gate approval, step-next, confidence gates (#95, #96, #99, #100, #101, #113) ([#116](https://github.com/cmbays/kata/issues/116))
- Wave B Session 1 — skill package + init integration ([#102](https://github.com/cmbays/kata/issues/102))
- Wave B Session 2 — POC execution + skill package iteration ([#117](https://github.com/cmbays/kata/issues/117)) ([#124](https://github.com/cmbays/kata/issues/124))
- *(#120 #121 #122)* Kata step complete, kata stage complete, kata gate set ([#127](https://github.com/cmbays/kata/issues/127))
- Add shaping and breadboarding skills
- Add breadboard-reflection skill
- Wire orchestration intelligence and resolve all 9 code+test review findings ([#130](https://github.com/cmbays/kata/issues/130))
- *(#105 #112)* Flavor resource aggregation + cooldown run data integration ([#131](https://github.com/cmbays/kata/issues/131))
- Rule suggestion pipeline — cooldown feedback loop (Wave C S3) ([#133](https://github.com/cmbays/kata/issues/133))
- Cross-run pattern analysis + yolo surfacing (Wave C S4) ([#134](https://github.com/cmbays/kata/issues/134))
- Batch config + kata init --scan (Wave D Session 1, closes #106) ([#135](https://github.com/cmbays/kata/issues/135))
- *(#53 #107)* Kata watch TUI + avatar/color system (Wave D Session 2) ([#146](https://github.com/cmbays/kata/issues/146))
- *([#52](https://github.com/cmbays/kata/issues/52))* Kata config TUI — full CRUD methodology editor ([#147](https://github.com/cmbays/kata/issues/147))
- *(#68 #70)* CLI lexicon overhaul + --plain flag ([#149](https://github.com/cmbays/kata/issues/149))
- *(#119 #33)* Init-handler error consistency + CLI visual polish
- *([#148](https://github.com/cmbays/kata/issues/148))* Cross-stage artifact dependency handling in gate conditions ([#151](https://github.com/cmbays/kata/issues/151))
- *(dojo)* Personal training environment for Kata (Wave K) ([#172](https://github.com/cmbays/kata/issues/172))

### Other

- Initial commit

### Refactor

- Apply kata lexicon — rei, flow, enbu, kiai, bunkai, ma
- English-primary CLI names, Japanese aliases
- Centralize path constants, extract CLI boilerplate, add domain ports
- Fix dependency direction violations, add port interfaces (arch debt)
- Make AdapterResolver.resolve() a static method ([#20](https://github.com/cmbays/kata/issues/20)) ([#31](https://github.com/cmbays/kata/issues/31))
- Rename Stage → Step across the codebase (fixes #36)
- FlavorValidationResult discriminated union + StepResolver FlavorStepRef (#64, #65) ([#92](https://github.com/cmbays/kata/issues/92))

