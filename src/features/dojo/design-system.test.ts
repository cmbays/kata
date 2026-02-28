import {
  DOJO_COLORS,
  DIRECTION_COLORS,
  barChart,
  sparkline,
  donutChart,
  horizontalBar,
  tailwindConfig,
  escapeSvgText,
} from './design-system.js';

// ── DOJO_COLORS ──────────────────────────────────────────────────────────────

describe('DOJO_COLORS', () => {
  it('has all expected theme keys', () => {
    const expectedKeys = ['ink', 'washi', 'aka', 'matcha', 'sora', 'kitsune', 'murasaki', 'stone', 'washiDark', 'inkLight'];
    for (const key of expectedKeys) {
      expect(DOJO_COLORS).toHaveProperty(key);
    }
  });

  it('values are hex color strings', () => {
    for (const value of Object.values(DOJO_COLORS)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

// ── DIRECTION_COLORS ─────────────────────────────────────────────────────────

describe('DIRECTION_COLORS', () => {
  it('has all four directions', () => {
    expect(DIRECTION_COLORS).toHaveProperty('backward');
    expect(DIRECTION_COLORS).toHaveProperty('inward');
    expect(DIRECTION_COLORS).toHaveProperty('outward');
    expect(DIRECTION_COLORS).toHaveProperty('forward');
  });

  it('maps backward to kitsune', () => {
    expect(DIRECTION_COLORS.backward).toBe(DOJO_COLORS.kitsune);
  });

  it('maps inward to sora', () => {
    expect(DIRECTION_COLORS.inward).toBe(DOJO_COLORS.sora);
  });

  it('maps outward to matcha', () => {
    expect(DIRECTION_COLORS.outward).toBe(DOJO_COLORS.matcha);
  });

  it('maps forward to murasaki', () => {
    expect(DIRECTION_COLORS.forward).toBe(DOJO_COLORS.murasaki);
  });
});

// ── escapeSvgText ────────────────────────────────────────────────────────────

describe('escapeSvgText', () => {
  it('escapes ampersands', () => {
    expect(escapeSvgText('A & B')).toBe('A &amp; B');
  });

  it('escapes angle brackets', () => {
    expect(escapeSvgText('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes quotes', () => {
    expect(escapeSvgText('"hello"')).toBe('&quot;hello&quot;');
    expect(escapeSvgText("it's")).toBe('it&#39;s');
  });

  it('handles combined special characters', () => {
    expect(escapeSvgText('<b>"A & B"</b>')).toBe('&lt;b&gt;&quot;A &amp; B&quot;&lt;/b&gt;');
  });
});

// ── barChart ─────────────────────────────────────────────────────────────────

describe('barChart', () => {
  it('returns SVG element', () => {
    const svg = barChart([{ label: 'A', value: 10 }]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('renders bars for each data point', () => {
    const svg = barChart([
      { label: 'A', value: 5 },
      { label: 'B', value: 10 },
    ]);
    expect(svg).toContain('>A</text>');
    expect(svg).toContain('>B</text>');
    expect(svg).toContain('>5</text>');
    expect(svg).toContain('>10</text>');
  });

  it('handles empty data', () => {
    const svg = barChart([]);
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('<rect');
  });

  it('respects custom colors', () => {
    const svg = barChart([{ label: 'X', value: 7, color: '#ff0000' }]);
    expect(svg).toContain('fill="#ff0000"');
  });

  it('uses default sora color when no color specified', () => {
    const svg = barChart([{ label: 'X', value: 7 }]);
    expect(svg).toContain(`fill="${DOJO_COLORS.sora}"`);
  });

  it('respects custom dimensions', () => {
    const svg = barChart([{ label: 'A', value: 1 }], { width: 600, height: 300 });
    expect(svg).toContain('viewBox="0 0 600 300"');
    expect(svg).toContain('width="600"');
    expect(svg).toContain('height="300"');
  });

  it('escapes labels containing HTML to prevent injection', () => {
    const svg = barChart([{ label: '<script>alert(1)</script>', value: 5 }]);
    expect(svg).not.toContain('<script>alert(1)</script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});

// ── sparkline ────────────────────────────────────────────────────────────────

describe('sparkline', () => {
  it('returns SVG with polyline', () => {
    const svg = sparkline({ values: [1, 3, 2, 5] });
    expect(svg).toContain('<svg');
    expect(svg).toContain('<polyline');
    expect(svg).toContain('points=');
  });

  it('returns empty string for fewer than 2 values', () => {
    expect(sparkline({ values: [] })).toBe('');
    expect(sparkline({ values: [5] })).toBe('');
  });

  it('uses custom color', () => {
    const svg = sparkline({ values: [1, 2], color: '#ff0000' });
    expect(svg).toContain('stroke="#ff0000"');
  });

  it('uses default sora color', () => {
    const svg = sparkline({ values: [1, 2] });
    expect(svg).toContain(`stroke="${DOJO_COLORS.sora}"`);
  });

  it('respects custom width and height', () => {
    const svg = sparkline({ values: [1, 2, 3], width: 200, height: 50 });
    expect(svg).toContain('width="200"');
    expect(svg).toContain('height="50"');
  });
});

// ── donutChart ───────────────────────────────────────────────────────────────

describe('donutChart', () => {
  it('returns SVG with arcs', () => {
    const svg = donutChart([
      { label: 'A', value: 50, color: '#ff0000' },
      { label: 'B', value: 50, color: '#00ff00' },
    ]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('<path');
  });

  it('handles single segment', () => {
    const svg = donutChart([{ label: 'Only', value: 100, color: '#3182ce' }]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('<path');
    expect(svg).toContain('stroke="#3182ce"');
  });

  it('returns empty string when total is zero', () => {
    const svg = donutChart([
      { label: 'A', value: 0, color: '#ff0000' },
      { label: 'B', value: 0, color: '#00ff00' },
    ]);
    expect(svg).toBe('');
  });

  it('returns empty string for empty data', () => {
    const svg = donutChart([]);
    expect(svg).toBe('');
  });

  it('renders multiple segment colors', () => {
    const svg = donutChart([
      { label: 'A', value: 30, color: '#ff0000' },
      { label: 'B', value: 50, color: '#00ff00' },
      { label: 'C', value: 20, color: '#0000ff' },
    ]);
    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain('stroke="#00ff00"');
    expect(svg).toContain('stroke="#0000ff"');
  });

  it('respects custom size and thickness', () => {
    const svg = donutChart([{ label: 'A', value: 1, color: '#000' }], { size: 200, thickness: 30 });
    expect(svg).toContain('width="200"');
    expect(svg).toContain('height="200"');
    expect(svg).toContain('stroke-width="30"');
  });
});

// ── horizontalBar ────────────────────────────────────────────────────────────

describe('horizontalBar', () => {
  it('returns div with percentage width', () => {
    const html = horizontalBar('Tests', 75, 100);
    expect(html).toContain('75.0%');
    expect(html).toContain('>Tests</span>');
    expect(html).toContain('>75</span>');
  });

  it('handles zero max gracefully', () => {
    const html = horizontalBar('Empty', 5, 0);
    expect(html).toContain('width: 0.0%');
  });

  it('caps overflow at 100%', () => {
    const html = horizontalBar('Over', 150, 100);
    expect(html).toContain('width: 100.0%');
  });

  it('uses custom color', () => {
    const html = horizontalBar('Custom', 50, 100, '#ff0000');
    expect(html).toContain('background: #ff0000');
  });

  it('uses default sora color when no color specified', () => {
    const html = horizontalBar('Default', 50, 100);
    expect(html).toContain(`background: ${DOJO_COLORS.sora}`);
  });

  it('escapes labels containing ampersands', () => {
    const html = horizontalBar('A & B', 50, 100);
    expect(html).toContain('A &amp; B');
    expect(html).not.toContain('>A & B<');
  });
});

// ── tailwindConfig ───────────────────────────────────────────────────────────

describe('tailwindConfig', () => {
  it('returns a valid JS string', () => {
    const config = tailwindConfig();
    expect(config).toContain('tailwind.config');
  });

  it('includes dojo color values', () => {
    const config = tailwindConfig();
    expect(config).toContain(DOJO_COLORS.ink);
    expect(config).toContain(DOJO_COLORS.washi);
    expect(config).toContain(DOJO_COLORS.aka);
    expect(config).toContain(DOJO_COLORS.matcha);
    expect(config).toContain(DOJO_COLORS.sora);
    expect(config).toContain(DOJO_COLORS.kitsune);
    expect(config).toContain(DOJO_COLORS.murasaki);
    expect(config).toContain(DOJO_COLORS.stone);
  });

  it('sets darkMode to class', () => {
    const config = tailwindConfig();
    expect(config).toContain("darkMode: 'class'");
  });

  it('includes Inter font family', () => {
    const config = tailwindConfig();
    expect(config).toContain('Inter');
  });
});
