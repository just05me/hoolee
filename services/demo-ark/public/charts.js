// Лёгкие SVG-чарты без библиотек. Цвета — через CSS-переменные в style=,
// поэтому графики сами переключаются со светлой темы на тёмную.

export function sparkline(values, { width = 120, height = 36, color = 'var(--accent)' } = {}) {
  if (!values.length) return '';
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1 || 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`);
  const line = pts.join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="overflow:visible">
    <polygon points="${area}" style="fill:${color};opacity:.12" />
    <polyline points="${line}" style="fill:none;stroke:${color};stroke-width:2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
}

export function barChart(data, { width = 560, height = 180, color = 'var(--accent)', fmt = (v) => v, id = 'bc' } = {}) {
  if (!data.length) return '<div class="empty"><div class="t">Нет данных</div></div>';
  const max = Math.max(...data.map((d) => d.value), 1);
  const gap = 8;
  const bw = (width - gap * (data.length - 1)) / data.length;
  const padTop = 22, padBottom = 22;
  const usableH = height - padTop - padBottom;
  let bars = '';
  data.forEach((d, i) => {
    const x = i * (bw + gap);
    const h = Math.max(2, (d.value / max) * usableH);
    const y = padTop + (usableH - h);
    const col = d.color || color;
    bars += `<g class="bar-g" data-i="${i}">
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4"
        style="fill:${col};opacity:.85" />
      <title>${d.label}: ${fmt(d.value)}</title>
      <text x="${(x + bw / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle"
        style="font:500 9.5px -apple-system,sans-serif;fill:var(--text-3)">${d.label}</text>
    </g>`;
  });
  return `<svg id="${id}" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMidYMid meet">
    <line x1="0" y1="${height - padBottom}" x2="${width}" y2="${height - padBottom}" style="stroke:var(--stroke)" />
    ${bars}
  </svg>`;
}

export function donut(segments, { size = 160, thickness = 22 } = {}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  let arcs = '';
  segments.forEach((s) => {
    const frac = s.value / total;
    const len = frac * circ;
    arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" style="stroke:${s.color}"
      stroke-width="${thickness}" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})">
      <title>${s.label}: ${Math.round(frac * 100)}%</title>
    </circle>`;
    offset += len;
  });
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${arcs}</svg>`;
}

export function hbar(data, { width = 480, barH = 22, gap = 10, color = 'var(--accent)', fmt = (v) => v } = {}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const rowH = barH + gap;
  const height = data.length * rowH;
  const labelW = 120;
  let rows = '';
  data.forEach((d, i) => {
    const y = i * rowH;
    const w = ((width - labelW) * d.value) / max;
    rows += `<text x="0" y="${y + barH / 2 + 4}" style="font:600 11px -apple-system,sans-serif;fill:var(--text-2)">${d.label}</text>
      <rect x="${labelW}" y="${y}" width="${Math.max(2, w).toFixed(1)}" height="${barH}" rx="5"
        style="fill:${d.color || color};opacity:.85" />
      <text x="${labelW + Math.max(2, w) + 8}" y="${y + barH / 2 + 4}" style="font:650 11px -apple-system,sans-serif;fill:var(--text)">${fmt(d.value)}</text>`;
  });
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">${rows}</svg>`;
}
