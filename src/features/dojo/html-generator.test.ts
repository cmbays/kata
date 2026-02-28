import type { DojoSession } from '@domain/types/dojo.js';
import { generateHtml } from './html-generator.js';
import { DOJO_COLORS, DIRECTION_COLORS } from './design-system.js';

function makeSession(overrides: Partial<DojoSession> = {}): DojoSession {
  return {
    id: crypto.randomUUID(),
    title: 'Sprint 4 Review',
    summary: 'Reviewing decision patterns from the last cycle.',
    topics: [
      {
        title: 'Decision quality',
        direction: 'backward',
        description: 'Review decisions',
        priority: 'high',
        tags: [],
      },
      {
        title: 'Auth migration',
        direction: 'forward',
        description: 'Plan auth migration',
        priority: 'medium',
        tags: [],
      },
    ],
    sections: [
      {
        title: 'Decision Timeline',
        type: 'narrative',
        topicTitle: 'Decision quality',
        content: 'We made **three key decisions** this cycle.',
        collapsed: false,
        depth: 0,
      },
      {
        title: 'Migration Steps',
        type: 'checklist',
        topicTitle: 'Auth migration',
        content: '[x] Research options\n[ ] Draft RFC\n[ ] Implement',
        collapsed: false,
        depth: 0,
      },
    ],
    diaryEntryIds: [],
    runIds: [],
    cycleIds: [],
    sourceIds: [],
    tags: ['decisions', 'auth'],
    createdAt: '2026-02-28T12:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

describe('generateHtml', () => {
  it('returns valid HTML with DOCTYPE', () => {
    const html = generateHtml(makeSession());
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('includes session title in <title> tag', () => {
    const html = generateHtml(makeSession({ title: 'My Custom Title' }));
    expect(html).toContain('<title>My Custom Title — Dojo</title>');
  });

  it('includes Tailwind CDN script', () => {
    const html = generateHtml(makeSession());
    expect(html).toContain('https://cdn.tailwindcss.com');
  });

  it('includes custom Tailwind config with dojo colors', () => {
    const html = generateHtml(makeSession());
    expect(html).toContain('tailwind.config');
    expect(html).toContain(DOJO_COLORS.ink);
    expect(html).toContain(DOJO_COLORS.sora);
    expect(html).toContain(DOJO_COLORS.aka);
  });

  it('renders topics grouped by direction', () => {
    const html = generateHtml(makeSession());
    // backward direction header
    expect(html).toContain('backward');
    // forward direction header
    expect(html).toContain('forward');
  });

  it('renders sections with proper card styling', () => {
    const html = generateHtml(makeSession());
    expect(html).toContain('bg-white dark:bg-gray-800 rounded-lg shadow-sm');
  });

  it('handles collapsed sections with <details>', () => {
    const session = makeSession({
      sections: [
        {
          title: 'Hidden Details',
          type: 'narrative',
          topicTitle: 'Decision quality',
          content: 'Some content here.',
          collapsed: true,
          depth: 0,
        },
      ],
    });
    const html = generateHtml(session);
    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    expect(html).toContain('Hidden Details');
  });

  it('renders code sections with <pre><code>', () => {
    const session = makeSession({
      sections: [
        {
          title: 'Code Example',
          type: 'code',
          topicTitle: 'Decision quality',
          content: 'const x = 42;',
          collapsed: false,
          depth: 0,
        },
      ],
    });
    const html = generateHtml(session);
    expect(html).toContain('<pre');
    expect(html).toContain('<code>');
    expect(html).toContain('const x = 42;');
  });

  it('renders checklist sections with checkboxes', () => {
    const html = generateHtml(makeSession());
    expect(html).toContain('<input type="checkbox"');
    expect(html).toContain('checked');
    expect(html).toContain('disabled');
  });

  it('escapes HTML entities in content', () => {
    const session = makeSession({
      title: 'Test <script>alert("xss")</script>',
      summary: 'A & B',
    });
    const html = generateHtml(session);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B');
    expect(html).not.toContain('<script>alert');
  });

  it('includes dark mode toggle button', () => {
    const html = generateHtml(makeSession());
    expect(html).toContain('Toggle Dark');
    expect(html).toContain("document.documentElement.classList.toggle('dark')");
  });

  it('includes dark mode auto-detection script', () => {
    const html = generateHtml(makeSession());
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain("classList.add('dark')");
  });

  it('includes print styles', () => {
    const html = generateHtml(makeSession());
    expect(html).toContain('@media print');
    expect(html).toContain('.no-print { display: none; }');
  });

  it('renders tags in header', () => {
    const html = generateHtml(makeSession());
    expect(html).toContain('decisions');
    expect(html).toContain('auth');
    expect(html).toContain('rounded-full');
  });

  it('omits tag section when tags are empty', () => {
    const session = makeSession({ tags: [] });
    const html = generateHtml(session);
    expect(html).not.toContain('rounded-full bg-gray-100');
  });

  it('handles empty topics gracefully', () => {
    const session = makeSession({ topics: [], sections: [] });
    const html = generateHtml(session);
    expect(html).toContain('0 topics');
    expect(html).toContain('0 sections');
  });

  it('handles empty sections gracefully', () => {
    const session = makeSession({ sections: [] });
    const html = generateHtml(session);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('0 sections');
  });

  it('includes footer with generation timestamp', () => {
    const html = generateHtml(makeSession());
    expect(html).toContain('Generated by');
    expect(html).toContain('kata dojo');
    expect(html).toContain('2026-02-28T12:00:00.000Z');
  });

  it('renders navigation sidebar with direction colors', () => {
    const html = generateHtml(makeSession());
    const backwardColor = DIRECTION_COLORS.backward;
    const forwardColor = DIRECTION_COLORS.forward;
    expect(html).toContain(`color: ${backwardColor}`);
    expect(html).toContain(`color: ${forwardColor}`);
  });

  it('renders topic section headers with color indicators', () => {
    const html = generateHtml(makeSession());
    expect(html).toContain('id="topic-decision-quality"');
    expect(html).toContain('id="topic-auth-migration"');
  });

  it('renders section depth as indentation class', () => {
    const session = makeSession({
      sections: [
        {
          title: 'Nested Item',
          type: 'narrative',
          topicTitle: 'Decision quality',
          content: 'Indented content.',
          collapsed: false,
          depth: 2,
        },
      ],
    });
    const html = generateHtml(session);
    expect(html).toContain('ml-8');
  });

  it('shows singular topic/section labels for count of 1', () => {
    const session = makeSession({
      topics: [{ title: 'Only', direction: 'inward', description: 'One', priority: 'low', tags: [] }],
      sections: [{ title: 'Single', type: 'narrative', topicTitle: 'Only', content: 'Hi', collapsed: false, depth: 0 }],
    });
    const html = generateHtml(session);
    expect(html).toContain('1 topic<');
    expect(html).toContain('1 section<');
  });

  it('sanitizes javascript: URLs in markdown links', () => {
    const session = makeSession({
      sections: [
        {
          title: 'XSS Link',
          type: 'narrative',
          topicTitle: 'Decision quality',
          content: '[click](javascript:alert(1))',
          collapsed: false,
          depth: 0,
        },
      ],
    });
    const html = generateHtml(session);
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="#"');
  });

  it('escapes script injection in markdown headings', () => {
    const session = makeSession({
      sections: [
        {
          title: 'Heading Injection',
          type: 'narrative',
          topicTitle: 'Decision quality',
          content: '# <script>alert(1)</script>',
          collapsed: false,
          depth: 0,
        },
      ],
    });
    const html = generateHtml(session);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes single quotes in title to &#39;', () => {
    const session = makeSession({ title: "It's a test" });
    const html = generateHtml(session);
    expect(html).toContain('It&#39;s a test');
    expect(html).not.toContain("It's a test");
  });

  it('includes @supports not fallback styles for Tailwind CDN', () => {
    const html = generateHtml(makeSession());
    expect(html).toContain('@supports not (--tw: 1)');
    expect(html).toContain('font-family: system-ui');
  });
});
