import type { DojoDiaryEntry, DojoSessionMeta, DojoSource } from '@domain/types/dojo.js';
import { getLexicon, cap } from '@cli/lexicon.js';

export function formatDojoSessionTable(sessions: DojoSessionMeta[], plain?: boolean): string {
  const lex = getLexicon(plain);
  if (sessions.length === 0) return `No ${lex.dojo} sessions found.`;

  const lines: string[] = [];
  lines.push(`${cap(lex.dojo)} Sessions`);
  lines.push('─'.repeat(60));

  for (const s of sessions) {
    const date = new Date(s.createdAt).toLocaleDateString();
    const tags = s.tags.length > 0 ? ` [${s.tags.join(', ')}]` : '';
    lines.push(`  ${s.id.slice(0, 8)}  ${date}  ${s.title}${tags}`);
    lines.push(`           ${s.topicCount} topics, ${s.sectionCount} sections`);
  }

  return lines.join('\n').trimEnd();
}

export function formatDojoSessionDetail(meta: DojoSessionMeta, plain?: boolean): string {
  const lex = getLexicon(plain);
  const lines: string[] = [];
  lines.push(`${cap(lex.dojo)} Session`);
  lines.push('─'.repeat(60));
  lines.push(`  ID:       ${meta.id}`);
  lines.push(`  Title:    ${meta.title}`);
  lines.push(`  Summary:  ${meta.summary}`);
  lines.push(`  Topics:   ${meta.topicCount}`);
  lines.push(`  Sections: ${meta.sectionCount}`);
  lines.push(`  Created:  ${new Date(meta.createdAt).toLocaleString()}`);
  if (meta.tags.length > 0) {
    lines.push(`  Tags:     ${meta.tags.join(', ')}`);
  }
  return lines.join('\n').trimEnd();
}

export function formatDojoDiaryTable(entries: DojoDiaryEntry[], plain?: boolean): string {
  const lex = getLexicon(plain);
  if (entries.length === 0) return `No ${lex.dojo} diary entries found.`;

  const lines: string[] = [];
  lines.push(`${cap(lex.dojo)} Diary`);
  lines.push('─'.repeat(60));

  for (const e of entries) {
    const date = new Date(e.createdAt).toLocaleDateString();
    const mood = e.mood ? ` (${e.mood})` : '';
    const name = e.cycleName ?? e.cycleId.slice(0, 8);
    lines.push(`  ${date}  ${name}${mood}`);
    lines.push(`           ${e.narrative.slice(0, 80)}${e.narrative.length > 80 ? '...' : ''}`);
    if (e.wins.length > 0) lines.push(`           Wins: ${e.wins.length}`);
    if (e.painPoints.length > 0) lines.push(`           Pain points: ${e.painPoints.length}`);
  }

  return lines.join('\n').trimEnd();
}

export function formatDojoDiaryEntry(entry: DojoDiaryEntry, plain?: boolean): string {
  const lex = getLexicon(plain);
  const lines: string[] = [];
  const name = entry.cycleName ?? entry.cycleId.slice(0, 8);
  lines.push(`${cap(lex.dojo)} Diary — ${name}`);
  lines.push('─'.repeat(60));
  lines.push(`  Cycle:  ${entry.cycleId}`);
  lines.push(`  Date:   ${new Date(entry.createdAt).toLocaleString()}`);
  if (entry.mood) lines.push(`  Mood:   ${entry.mood}`);
  lines.push('');
  lines.push(entry.narrative);
  if (entry.wins.length > 0) {
    lines.push('');
    lines.push('Wins:');
    for (const w of entry.wins) lines.push(`  + ${w}`);
  }
  if (entry.painPoints.length > 0) {
    lines.push('');
    lines.push('Pain Points:');
    for (const p of entry.painPoints) lines.push(`  - ${p}`);
  }
  if (entry.openQuestions.length > 0) {
    lines.push('');
    lines.push('Open Questions:');
    for (const q of entry.openQuestions) lines.push(`  ? ${q}`);
  }
  if (entry.tags.length > 0) {
    lines.push('');
    lines.push(`Tags: ${entry.tags.join(', ')}`);
  }
  return lines.join('\n').trimEnd();
}

export function formatDojoSourceTable(sources: DojoSource[], plain?: boolean): string {
  const lex = getLexicon(plain);
  if (sources.length === 0) return `No ${lex.dojo} sources configured.`;
  const lines: string[] = [];
  lines.push(`${cap(lex.dojo)} Sources`);
  lines.push('─'.repeat(60));
  for (const s of sources) {
    const status = s.active ? '●' : '○';
    const domains = s.domains.length > 0 ? ` (${s.domains.join(', ')})` : '';
    lines.push(`  ${status} ${s.name}  [${s.reputation}]${domains}`);
    lines.push(`    ${s.url}`);
  }
  return lines.join('\n').trimEnd();
}

// JSON formatters
export function formatDojoSessionTableJson(sessions: DojoSessionMeta[]): string {
  return JSON.stringify(sessions, null, 2);
}

export function formatDojoSessionDetailJson(meta: DojoSessionMeta): string {
  return JSON.stringify(meta, null, 2);
}

export function formatDojoDiaryTableJson(entries: DojoDiaryEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

export function formatDojoDiaryEntryJson(entry: DojoDiaryEntry): string {
  return JSON.stringify(entry, null, 2);
}

export function formatDojoSourceTableJson(sources: DojoSource[]): string {
  return JSON.stringify(sources, null, 2);
}
