import type { DojoTopic, DojoContentSection } from '@domain/types/dojo.js';
import { DojoSessionSchema } from '@domain/types/dojo.js';
import type { DojoDataBundle } from './data-aggregator.js';
import { SessionStore } from '@infra/dojo/session-store.js';
import { generateHtml } from './html-generator.js';
import { barChart, sparkline, DIRECTION_COLORS } from './design-system.js';
import type { DojoSessionMeta } from '@domain/types/dojo.js';

export interface SessionBuilderDeps {
  sessionStore: SessionStore;
}

export interface SessionBuildOptions {
  title?: string;
  topics?: DojoTopic[];
}

export class SessionBuilder {
  constructor(private readonly deps: SessionBuilderDeps) {}

  build(data: DojoDataBundle, options?: SessionBuildOptions): { meta: DojoSessionMeta; htmlPath: string } {
    const topics = options?.topics ?? this.generateDefaultTopics(data);
    const sections = this.generateSections(data, topics);
    const title = options?.title ?? this.generateTitle(data);

    const session = DojoSessionSchema.parse({
      id: crypto.randomUUID(),
      title,
      summary: this.generateSummary(data),
      topics,
      sections,
      diaryEntryIds: data.backward.recentDiaries.map((d) => d.id),
      cycleIds: data.backward.cycles.map((c) => c.id),
      tags: this.extractSessionTags(data),
      createdAt: new Date().toISOString(),
      version: 1,
    });

    const html = generateHtml(session);
    const meta = this.deps.sessionStore.save(session, html);
    const htmlPath = this.deps.sessionStore.getHtmlPath(session.id);

    return { meta, htmlPath: htmlPath! };
  }

  private generateTitle(data: DojoDataBundle): string {
    const cycleCount = data.metadata.totalCycles;
    if (cycleCount === 0) return 'Dojo — Getting Started';
    const latestDiary = data.backward.recentDiaries[0];
    if (latestDiary?.cycleName) return `Dojo — ${latestDiary.cycleName} Review`;
    return `Dojo — Training Session`;
  }

  private generateSummary(data: DojoDataBundle): string {
    const parts: string[] = [];
    if (data.metadata.totalCycles > 0) {
      parts.push(`Based on ${data.metadata.totalCycles} cycle(s) and ${data.metadata.totalRuns} run(s).`);
    }
    if (data.backward.topLearnings.length > 0) {
      parts.push(`${data.backward.topLearnings.length} learning(s) reviewed.`);
    }
    if (data.backward.recurringGaps.length > 0) {
      parts.push(`${data.backward.recurringGaps.length} recurring gap(s) identified.`);
    }
    return parts.join(' ') || 'A fresh training session with no prior data.';
  }

  private generateDefaultTopics(data: DojoDataBundle): DojoTopic[] {
    const topics: DojoTopic[] = [];

    // Backward
    if (data.backward.recentDiaries.length > 0 || data.backward.runSummaries.length > 0) {
      topics.push({
        title: 'Execution History',
        direction: 'backward',
        description: 'Review past decisions, outcomes, and patterns.',
        priority: 'high',
        tags: ['history', 'decisions'],
      });
    }

    // Inward
    topics.push({
      title: 'Project State',
      direction: 'inward',
      description: 'Current knowledge stats, flavor usage, and confidence.',
      priority: 'medium',
      tags: ['stats', 'knowledge'],
    });

    // Outward
    if (data.backward.recurringGaps.length > 0) {
      topics.push({
        title: 'Best Practices',
        direction: 'outward',
        description: 'Industry practices relevant to recurring gaps.',
        priority: 'medium',
        tags: ['practices', 'gaps'],
      });
    }

    // Forward
    topics.push({
      title: 'What\'s Next',
      direction: 'forward',
      description: 'Upcoming work, proposals, and open questions.',
      priority: 'high',
      tags: ['planning', 'proposals'],
    });

    return topics;
  }

  private generateSections(data: DojoDataBundle, topics: DojoTopic[]): DojoContentSection[] {
    const sections: DojoContentSection[] = [];

    for (const topic of topics) {
      switch (topic.direction) {
        case 'backward':
          sections.push(...this.backwardSections(data, topic));
          break;
        case 'inward':
          sections.push(...this.inwardSections(data, topic));
          break;
        case 'outward':
          sections.push(...this.outwardSections(data, topic));
          break;
        case 'forward':
          sections.push(...this.forwardSections(data, topic));
          break;
      }
    }

    return sections;
  }

  private backwardSections(data: DojoDataBundle, topic: DojoTopic): DojoContentSection[] {
    const sections: DojoContentSection[] = [];

    // Diary narratives
    if (data.backward.recentDiaries.length > 0) {
      const narratives = data.backward.recentDiaries
        .map((d) => `### ${d.cycleName ?? d.cycleId.slice(0, 8)}\n${d.narrative}`)
        .join('\n\n');
      sections.push({
        title: 'Recent Diary Entries',
        type: 'narrative',
        topicTitle: topic.title,
        content: narratives,
        collapsed: false,
        depth: 0,
      });
    }

    // Gap analysis
    if (data.backward.recurringGaps.length > 0) {
      const gapList = data.backward.recurringGaps
        .map((g) => `- **${g.severity}**: ${g.description} (${g.betCount} occurrences)`)
        .join('\n');
      sections.push({
        title: 'Recurring Gaps',
        type: 'narrative',
        topicTitle: topic.title,
        content: gapList,
        collapsed: false,
        depth: 0,
      });
    }

    // Run stats chart
    if (data.backward.runSummaries.length > 0) {
      const chartData = data.backward.runSummaries.map((r, i) => ({
        label: `R${i + 1}`,
        value: r.stagesCompleted,
        color: DIRECTION_COLORS.backward,
      }));
      sections.push({
        title: 'Stages Completed per Run',
        type: 'chart',
        topicTitle: topic.title,
        content: barChart(chartData),
        collapsed: true,
        depth: 1,
      });
    }

    return sections;
  }

  private inwardSections(data: DojoDataBundle, topic: DojoTopic): DojoContentSection[] {
    const sections: DojoContentSection[] = [];
    const stats = data.inward.knowledgeStats;

    // Knowledge overview
    const overview = [
      `**Total learnings**: ${stats.total}`,
      `**Average confidence**: ${(stats.averageConfidence * 100).toFixed(0)}%`,
    ];
    if (Object.keys(stats.byTier).length > 0) {
      overview.push(`**By tier**: ${Object.entries(stats.byTier).map(([t, c]) => `${t}: ${c}`).join(', ')}`);
    }
    if (stats.topCategories.length > 0) {
      overview.push(`**Top categories**: ${stats.topCategories.map((tc) => `${tc.category}: ${tc.count}`).join(', ')}`);
    }

    sections.push({
      title: 'Knowledge Overview',
      type: 'narrative',
      topicTitle: topic.title,
      content: overview.join('\n'),
      collapsed: false,
      depth: 0,
    });

    // Flavor frequency
    if (data.inward.flavorFrequency.size > 0) {
      const chartData = [...data.inward.flavorFrequency.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ label: name.slice(0, 10), value: count, color: DIRECTION_COLORS.inward }));
      sections.push({
        title: 'Most Used Flavors',
        type: 'chart',
        topicTitle: topic.title,
        content: barChart(chartData),
        collapsed: true,
        depth: 1,
      });
    }

    // Top learnings
    if (data.backward.topLearnings.length > 0) {
      const learningList = data.backward.topLearnings
        .slice(0, 10)
        .map((l) => `- [${(l.confidence * 100).toFixed(0)}%] ${l.content}`)
        .join('\n');
      sections.push({
        title: 'Top Learnings',
        type: 'narrative',
        topicTitle: topic.title,
        content: learningList,
        collapsed: true,
        depth: 1,
      });
    }

    return sections;
  }

  private outwardSections(data: DojoDataBundle, topic: DojoTopic): DojoContentSection[] {
    const sections: DojoContentSection[] = [];

    // Recurring gaps framed as research areas
    if (data.backward.recurringGaps.length > 0) {
      const checklist = data.backward.recurringGaps
        .map((g) => `[ ] Research best practices for: ${g.description}`)
        .join('\n');
      sections.push({
        title: 'Research Checklist',
        type: 'checklist',
        topicTitle: topic.title,
        content: checklist,
        collapsed: false,
        depth: 0,
      });
    }

    return sections;
  }

  private forwardSections(data: DojoDataBundle, topic: DojoTopic): DojoContentSection[] {
    const sections: DojoContentSection[] = [];

    // Open questions from diaries
    const allQuestions = data.backward.recentDiaries.flatMap((d) => d.openQuestions);
    if (allQuestions.length > 0) {
      sections.push({
        title: 'Open Questions',
        type: 'narrative',
        topicTitle: topic.title,
        content: allQuestions.map((q) => `- ${q}`).join('\n'),
        collapsed: false,
        depth: 0,
      });
    }

    // Confidence sparkline
    if (data.backward.runSummaries.length >= 2) {
      const values = data.backward.runSummaries
        .filter((r) => r.avgConfidence !== null)
        .map((r) => r.avgConfidence!);
      if (values.length >= 2) {
        sections.push({
          title: 'Confidence Trend',
          type: 'chart',
          topicTitle: topic.title,
          content: sparkline({ values, color: DIRECTION_COLORS.forward }),
          collapsed: true,
          depth: 1,
        });
      }
    }

    return sections;
  }

  private extractSessionTags(data: DojoDataBundle): string[] {
    const tags = new Set<string>();
    for (const diary of data.backward.recentDiaries) {
      for (const tag of diary.tags) tags.add(tag);
    }
    if (data.backward.recurringGaps.length > 0) tags.add('gaps');
    return [...tags].sort();
  }
}
