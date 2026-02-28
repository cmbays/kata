/**
 * Dojo design system — SVG chart utilities and theme constants.
 * All functions return raw strings (SVG or CSS) for inlining into HTML.
 */

// ── Theme Colors ─────────────────────────────────────────────────────────────

export const DOJO_COLORS = {
  ink: '#1a1b2e',         // Deep indigo (primary text)
  washi: '#f5f0e8',       // Warm off-white (background)
  aka: '#c53030',         // Torii gate red (emphasis)
  matcha: '#38a169',      // Green (success/growth)
  sora: '#3182ce',        // Sky blue (inward)
  kitsune: '#d69e2e',     // Amber/gold (backward)
  murasaki: '#805ad5',    // Purple (forward)
  stone: '#718096',       // Muted gray
  washiDark: '#1e1f33',   // Dark mode background
  inkLight: '#e2e8f0',    // Dark mode text
} as const;

export const DIRECTION_COLORS: Record<string, string> = {
  backward: DOJO_COLORS.kitsune,
  inward: DOJO_COLORS.sora,
  outward: DOJO_COLORS.matcha,
  forward: DOJO_COLORS.murasaki,
};

// ── SVG Text Escaping ────────────────────────────────────────────────────────

export function escapeSvgText(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── SVG Charts ───────────────────────────────────────────────────────────────

export interface BarChartData {
  label: string;
  value: number;
  color?: string;
}

export function barChart(data: BarChartData[], opts?: { width?: number; height?: number; barWidth?: number }): string {
  const width = opts?.width ?? 400;
  const height = opts?.height ?? 200;
  const barWidth = opts?.barWidth ?? 40;
  const max = Math.max(...data.map((d) => d.value), 1);
  const gap = Math.min(20, (width - data.length * barWidth) / Math.max(data.length - 1, 1));
  const totalWidth = data.length * barWidth + Math.max(data.length - 1, 0) * gap;
  const startX = (width - totalWidth) / 2;
  const chartBottom = height - 30;
  const chartHeight = chartBottom - 10;

  let bars = '';
  for (let i = 0; i < data.length; i++) {
    const d = data[i]!;
    const barH = (d.value / max) * chartHeight;
    const x = startX + i * (barWidth + gap);
    const y = chartBottom - barH;
    const color = d.color ?? DOJO_COLORS.sora;
    bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="${color}" rx="3" />`;
    bars += `<text x="${x + barWidth / 2}" y="${chartBottom + 16}" text-anchor="middle" font-size="11" fill="${DOJO_COLORS.stone}">${escapeSvgText(d.label)}</text>`;
    bars += `<text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" font-size="10" fill="${DOJO_COLORS.ink}">${escapeSvgText(String(d.value))}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${bars}</svg>`;
}

export interface SparklineData {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}

export function sparkline(data: SparklineData): string {
  const { values, color = DOJO_COLORS.sora, width = 120, height = 30 } = data;
  if (values.length < 2) return '';
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
}

export interface DonutChartData {
  label: string;
  value: number;
  color: string;
}

export function donutChart(data: DonutChartData[], opts?: { size?: number; thickness?: number }): string {
  const size = opts?.size ?? 120;
  const thickness = opts?.thickness ?? 20;
  const radius = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return '';

  // Single segment: full circle would degenerate (start point === end point),
  // so render a <circle> instead of an arc path.
  if (data.length === 1) {
    const strokeWidth = thickness;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${data[0]!.color}" stroke-width="${strokeWidth}"/></svg>`;
  }

  let currentAngle = -90;
  let paths = '';

  for (const d of data) {
    const angle = (d.value / total) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const largeArc = angle > 180 ? 1 : 0;

    const x1 = cx + radius * Math.cos(startRad);
    const y1 = cy + radius * Math.sin(startRad);
    const x2 = cx + radius * Math.cos(endRad);
    const y2 = cy + radius * Math.sin(endRad);

    paths += `<path d="M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}" fill="none" stroke="${d.color}" stroke-width="${thickness}" />`;
    currentAngle = endAngle;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${paths}</svg>`;
}

export function horizontalBar(label: string, value: number, max: number, color?: string): string {
  const barColor = color ?? DOJO_COLORS.sora;
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return `<div class="flex items-center gap-3 text-sm">
  <span class="w-24 text-right text-gray-500">${escapeSvgText(label)}</span>
  <div class="flex-1 h-4 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
    <div class="h-full rounded-full" style="width: ${pct.toFixed(1)}%; background: ${barColor};"></div>
  </div>
  <span class="w-12 text-gray-600 dark:text-gray-400">${escapeSvgText(String(value))}</span>
</div>`;
}

// ── Tailwind Config ──────────────────────────────────────────────────────────

export function tailwindConfig(): string {
  return `tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dojo: {
          ink: '${DOJO_COLORS.ink}',
          washi: '${DOJO_COLORS.washi}',
          aka: '${DOJO_COLORS.aka}',
          matcha: '${DOJO_COLORS.matcha}',
          sora: '${DOJO_COLORS.sora}',
          kitsune: '${DOJO_COLORS.kitsune}',
          murasaki: '${DOJO_COLORS.murasaki}',
          stone: '${DOJO_COLORS.stone}',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    }
  }
}`;
}
