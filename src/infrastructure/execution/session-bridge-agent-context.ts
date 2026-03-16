import type { PreparedRun } from '@domain/ports/session-bridge.js';
import type { ExecutionManifest } from '@domain/types/manifest.js';
import type { LaunchMode, SessionContext } from '@shared/lib/session-context.js';

type GateCondition = NonNullable<ExecutionManifest['entryGate']>['conditions'][number];

interface AgentContextEnvironment {
  launchMode: LaunchMode;
  repoRoot: string;
  sessionContext: SessionContext;
}

export function formatSessionBridgeAgentContext(
  prepared: PreparedRun,
  environment: AgentContextEnvironment,
): string {
  const lines: string[] = [];

  appendLaunchContext(lines, prepared, environment);
  appendRunContext(lines, prepared);
  appendProductionExpectations(lines, prepared);
  appendGateInstructions(lines, prepared.manifest);
  appendGitWorkflow(lines, prepared);
  appendRestApiGuidance(lines);
  appendRecordingGuidance(lines, prepared.runId, environment.repoRoot);
  appendInjectedLearnings(lines, prepared.manifest);
  appendCompletionChecklist(lines);

  return lines.join('\n');
}

function appendLaunchContext(
  lines: string[],
  prepared: PreparedRun,
  environment: AgentContextEnvironment,
): void {
  lines.push('## Launch context');
  lines.push('');
  lines.push(`- **Launch mode**: ${environment.launchMode}`);
  lines.push(`- **In worktree**: ${environment.sessionContext.inWorktree ? 'yes' : 'no'}`);
  lines.push(`- **Kata dir resolved**: ${environment.sessionContext.kataDir ?? prepared.kataDir}`);
  if (environment.launchMode !== 'interactive' && !environment.sessionContext.inWorktree) {
    lines.push('- **Note**: running as agent outside a git worktree — use `--cwd` to point kata commands at the main repo.');
  }
  lines.push('');
}

function appendRunContext(lines: string[], prepared: PreparedRun): void {
  lines.push('## Kata Run Context');
  lines.push('');
  lines.push('You are executing inside a kata run. Record your work as you go.');
  lines.push('');
  lines.push(`- **Run ID**: ${prepared.runId}`);
  lines.push(`- **Bet ID**: ${prepared.betId}`);
  lines.push(`- **Cycle ID**: ${prepared.cycleId}`);
  lines.push(`- **Kata dir**: ${prepared.kataDir}`);
  lines.push(`- **Stages**: ${prepared.stages.join(', ')}`);
  lines.push('');
}

function appendProductionExpectations(lines: string[], prepared: PreparedRun): void {
  lines.push('### What to produce');
  lines.push(`Execute the bet: "${prepared.betName}"`);
  appendArtifacts(lines, prepared.manifest);
  lines.push('');
}

function appendArtifacts(lines: string[], manifest: ExecutionManifest): void {
  if (manifest.artifacts.length === 0) {
    return;
  }

  lines.push('');
  lines.push('Expected artifacts:');
  for (const artifact of manifest.artifacts) {
    const requirementLabel = artifact.required !== false ? '[required]' : '[optional]';
    lines.push(`  - ${artifact.name} ${requirementLabel}${artifact.description ? ` — ${artifact.description}` : ''}`);
  }
}

function appendGateInstructions(lines: string[], manifest: ExecutionManifest): void {
  if (!manifest.entryGate && !manifest.exitGate) {
    return;
  }

  lines.push('### Gates');
  appendGateSection(lines, manifest.entryGate, 'Entry gate', 'If you cannot satisfy an entry gate, STOP and report to the sensei.');
  appendGateSection(lines, manifest.exitGate, 'Exit gate', 'Your output must satisfy these conditions. The sensei will verify.');
  lines.push('Do not skip gates — the sensei catches violations at stage boundaries.');
  lines.push('');
}

function appendGateSection(
  lines: string[],
  gate: ExecutionManifest['entryGate'] | ExecutionManifest['exitGate'] | undefined,
  label: string,
  closingInstruction: string,
): void {
  if (!gate) {
    return;
  }

  lines.push(`**${label}** (${gate.type}):`);
  for (const condition of gate.conditions) {
    const description = condition.description ?? describeGateCondition(condition);
    lines.push(`  - [${condition.type}] ${description}`);
  }
  lines.push(`  ${closingInstruction}`);
  lines.push('');
}

function appendGitWorkflow(lines: string[], prepared: PreparedRun): void {
  lines.push('### Git workflow');
  lines.push('You are working in a git worktree. **NEVER commit directly to the `main` branch.**');
  lines.push('');
  lines.push('Before your first commit, create a feature branch:');
  lines.push(`  git checkout -b keiko-${prepared.runId.slice(0, 8)}/${slugifyBetName(prepared.betName)}`);
  lines.push('');
  lines.push('Then commit to that branch and open a PR. The sensei will merge.');
  lines.push('');
  lines.push('To ensure hooks can detect your agent context, set this env var in your shell before git operations:');
  lines.push(`  export KATA_RUN_ID=${prepared.runId}`);
  lines.push('');
}

function appendRestApiGuidance(lines: string[]): void {
  lines.push('### PR operations — use REST API, not GraphQL');
  lines.push('`gh pr create`, `gh pr view --json`, and `gh pr merge` all use GitHub GraphQL (5000/hr quota).');
  lines.push('With parallel agents, this quota drains fast. **Use REST API for all PR operations:**');
  lines.push('');
  lines.push('```bash');
  lines.push('# Create PR');
  lines.push('gh api repos/{owner}/{repo}/pulls -X POST \\');
  lines.push('  --field title="..." --field body="..." \\');
  lines.push('  --field head="branch-name" --field base="main"');
  lines.push('');
  lines.push('# Get PR number by branch');
  lines.push('gh api "repos/{owner}/{repo}/pulls?head={owner}:branch-name"');
  lines.push('');
  lines.push('# Merge PR');
  lines.push('gh api repos/{owner}/{repo}/pulls/NNN/merge -X PUT \\');
  lines.push('  --field merge_method=squash');
  lines.push('');
  lines.push('# List PR reviews');
  lines.push('gh api repos/{owner}/{repo}/pulls/NNN/reviews');
  lines.push('```');
  lines.push('');
}

function appendRecordingGuidance(lines: string[], runId: string, repoRoot: string): void {
  lines.push('### Record as you work');
  lines.push('Use these commands at natural checkpoints — when a decision matters, when something surprises you, when you hit resistance:');
  lines.push('');
  lines.push(`  kata --cwd ${repoRoot} kansatsu record <type> "..." --run ${runId}`);
  lines.push(`  kata --cwd ${repoRoot} maki record <name> <path> --run ${runId}`);
  lines.push(`  kata --cwd ${repoRoot} kime record --decision "..." --rationale "..." --run ${runId}`);
  lines.push('');
  lines.push('**kime vs kansatsu — which to use for decisions:**');
  lines.push('  `kime record` is for decisions with explicit, trackable outcomes. Use kime when:');
  lines.push('    - You make a significant architectural or approach decision');
  lines.push('    - You can state what "success" or "failure" looks like for this decision');
  lines.push('    - Belt advancement tracks these directly as decision-outcome pairs');
  lines.push('  `kansatsu record decision` + `kansatsu record outcome` is for paired run observations. Use when:');
  lines.push('    - You want to log a decision as part of a broader observational record');
  lines.push('    - Belt also counts these as min(decisions, outcomes) pairs — secondary signal');
  lines.push('  **Prefer `kime record` for significant decisions — it is the primary belt metric.**');
  lines.push('');
  lines.push('**Observation types** — pick the most specific:');
  lines.push('  decision    — a choice between real alternatives; always include WHY you chose this path');
  lines.push('  prediction  — a testable bet about future behavior (state what would falsify it)');
  lines.push('  assumption  — something you are treating as true but have not verified');
  lines.push('  friction    — something that slowed you down; requires --taxonomy (see below)');
  lines.push('  gap         — missing capability, coverage, or information; requires --severity critical|major|minor');
  lines.push('  outcome     — factual result after a decision or prediction resolves');
  lines.push('  insight     — non-obvious learning that would change your approach in a similar situation');
  lines.push('');
  lines.push('**FRICTION — record immediately, before continuing:**');
  lines.push('When you hit a wall, get blocked, or need a workaround — record it as friction BEFORE resuming work.');
  lines.push('Do not defer to the summary. Friction recorded mid-run is the signal; friction in prose is noise.');
  lines.push('');
  lines.push('Example friction record (copy-paste and fill in):');
  lines.push(`  kata --cwd ${repoRoot} kansatsu record friction "lint-staged reverted my edits to execute.ts between two Edit calls" --run ${runId} --taxonomy tool-mismatch`);
  lines.push('');
  lines.push('**Friction taxonomy** (--taxonomy <value> — required for friction type):');
  lines.push('  stale-learning   — your expected pattern was outdated or wrong in this context');
  lines.push('  config-drift     — actual env/files/settings do not match documented expectations');
  lines.push('  convention-clash — established code convention conflicts with the natural approach');
  lines.push('  tool-mismatch    — available tool required workarounds; not quite right for the job');
  lines.push('  scope-creep      — work expanded beyond the original bet boundary during execution');
  lines.push('  agent-override   — user directed a different approach from what you would have chosen');
  lines.push('');
  lines.push('**Quality bar** — ask: would a future agent reading this understand what happened and why?');
  lines.push('  weak:   "Features already in main, issues can be closed"');
  lines.push('  strong: "Bets silently become redundant when issues stay open after merging — triage needs a closed-issue pre-flight"');
  lines.push('');
}

function appendInjectedLearnings(lines: string[], manifest: ExecutionManifest): void {
  if (manifest.learnings.length === 0) {
    return;
  }

  lines.push('### Injected Learnings');
  lines.push('These patterns were captured from previous executions:');
  lines.push('');
  for (const learning of manifest.learnings) {
    const confidence = learning.confidence !== undefined
      ? ` (confidence: ${(learning.confidence * 100).toFixed(0)}%)`
      : '';
    lines.push(`  - [${learning.tier}/${learning.category}]${confidence}`);
    lines.push(`    ${learning.content}`);
  }
  lines.push('');
}

function appendCompletionChecklist(lines: string[]): void {
  lines.push('### When you\'re done');
  lines.push('Before reporting back — did you record all friction events?');
  lines.push('Check: rate limits hit, unexpected tool behavior, workarounds needed, anything that took more than one try.');
  lines.push('If any of those happened and you have not recorded them yet, record them now before continuing.');
  lines.push('');
  lines.push('Report back to the sensei with a summary of:');
  lines.push('- What you produced (artifacts)');
  lines.push('- Any decisions you made and why');
  lines.push('- Any issues or blockers encountered');
  lines.push('Do NOT close the run yourself — the sensei handles run lifecycle.');
}

export function describeGateCondition(condition: GateCondition): string {
  const formatters: Record<string, (input: GateCondition) => string> = {
    'artifact-exists': (input) => input.artifactName ? `artifact "${input.artifactName}" must exist` : 'required artifact must exist',
    'predecessor-complete': (input) => input.predecessorType ? `stage "${input.predecessorType}" must be complete` : 'predecessor must be complete',
    'human-approved': () => 'requires human approval',
    'schema-valid': () => 'output must pass schema validation',
    'command-passes': () => 'command must exit with code 0',
  };

  return formatters[condition.type]?.(condition) ?? condition.type;
}

function slugifyBetName(betName: string): string {
  return betName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}
