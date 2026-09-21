// Канвас-рендер графа: используется и для оргструктуры, и для базы знаний.
// Координаты узлов — относительные (0..1), пересчёт в пиксели делает сам рендер.
// Учитывает prefers-reduced-motion: без бегущих пульсов и «дыхания», только смена состояний.

const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class GraphRenderer {
  constructor(canvas, { onNodeClick, onNodeHover } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onNodeClick = onNodeClick || (() => {});
    this.onNodeHover = onNodeHover || (() => {});
    this.nodes = [];
    this.edges = [];
    this.pulses = [];
    this.hoverId = null;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._resizeObs = new ResizeObserver(() => this._resize());
    this._resizeObs.observe(canvas);
    this._resize();
    canvas.addEventListener('click', (e) => this._handleClick(e));
    canvas.addEventListener('mousemove', (e) => this._handleMove(e));
    canvas.addEventListener('mouseleave', () => { this.hoverId = null; this.canvas.style.cursor = 'default'; });
    this._raf = requestAnimationFrame((t) => this._tick(t));
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._resizeObs.disconnect();
  }

  setGraph({ nodes, edges }) {
    this.nodes = nodes;
    this.edges = edges;
  }

  updateNode(id, patch) {
    const n = this.nodes.find((x) => x.id === id);
    if (n) Object.assign(n, patch);
  }

  addNode(node) {
    if (!this.nodes.find((x) => x.id === node.id)) this.nodes.push(node);
  }

  addEdge(edge) {
    if (!this.edges.find((e) => e.from === edge.from && e.to === edge.to)) this.edges.push(edge);
  }

  pulse(fromId, toId, opts = {}) {
    if (REDUCED_MOTION) {
      this.updateNode(toId, { flash: performance.now() });
      return;
    }
    const from = this.nodes.find((n) => n.id === fromId);
    const to = this.nodes.find((n) => n.id === toId);
    if (!from || !to) return;
    this.pulses.push({
      from, to,
      start: performance.now(),
      duration: opts.duration || 900,
      color: opts.color || 'var(--accent)',
    });
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.w = rect.width; this.h = rect.height;
  }

  _px(n) { return { x: n.x * this.w, y: n.y * this.h }; }

  _handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    for (const n of this.nodes) {
      const p = this._px(n);
      if (Math.hypot(mx - p.x, my - p.y) <= (n.r || 22) + 4) { this.onNodeClick(n.id); return; }
    }
  }

  _handleMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let hit = null;
    for (const n of this.nodes) {
      const p = this._px(n);
      if (Math.hypot(mx - p.x, my - p.y) <= (n.r || 22) + 4) { hit = n.id; break; }
    }
    if (hit !== this.hoverId) { this.hoverId = hit; this.onNodeHover(hit); }
    this.canvas.style.cursor = hit ? 'pointer' : 'default';
  }

  _resolveColor(c) {
    if (!c) return '#8E929B';
    if (c.startsWith('var(')) {
      const varName = c.slice(4, -1);
      return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || '#8E929B';
    }
    return c;
  }

  _tick(now) {
    this._raf = requestAnimationFrame((t) => this._tick(t));
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.w, this.h);

    // edges
    for (const e of this.edges) {
      const a = this.nodes.find((n) => n.id === e.from);
      const b = this.nodes.find((n) => n.id === e.to);
      if (!a || !b) continue;
      const pa = this._px(a), pb = this._px(b);
      ctx.beginPath();
      ctx.strokeStyle = this._resolveColor(e.dashed ? 'var(--stroke)' : 'var(--stroke)');
      ctx.lineWidth = e.width || 1.4;
      if (e.dashed) ctx.setLineDash([4, 5]); else ctx.setLineDash([]);
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // pulses (traveling dots)
    if (!REDUCED_MOTION) {
      this.pulses = this.pulses.filter((p) => now - p.start < p.duration);
      for (const p of this.pulses) {
        const t = Math.min(1, (now - p.start) / p.duration);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const pa = this._px(p.from), pb = this._px(p.to);
        const x = pa.x + (pb.x - pa.x) * ease;
        const y = pa.y + (pb.y - pa.y) * ease;
        const color = this._resolveColor(p.color);
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // nodes
    for (const n of this.nodes) {
      const p = this._px(n);
      const r = n.r || 22;
      const color = this._resolveColor(n.color);
      const isHover = this.hoverId === n.id;
      const flashActive = n.flash && now - n.flash < 700;

      if (n.active || flashActive) {
        const breathe = REDUCED_MOTION ? 1 : 0.6 + 0.4 * Math.sin(now / 260);
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.16 * breathe;
        ctx.arc(p.x, p.y, r + 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.beginPath();
      ctx.fillStyle = this._resolveColor('var(--surface-solid)');
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = isHover ? 3 : 2;
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();

      if (n.dormant) {
        ctx.globalAlpha = 0.35;
      }

      ctx.fillStyle = color;
      ctx.font = `700 ${Math.max(10, r * 0.42)}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.glyph || (n.label ? n.label[0] : '?'), p.x, p.y + 1);
      ctx.globalAlpha = 1;

      if (n.showLabel !== false) {
        ctx.fillStyle = this._resolveColor('var(--text)');
        ctx.font = `650 11.5px -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(n.label || '', p.x, p.y + r + 16);
        if (n.sub) {
          ctx.fillStyle = this._resolveColor('var(--text-3)');
          ctx.font = `500 10px -apple-system, sans-serif`;
          ctx.fillText(n.sub, p.x, p.y + r + 30);
        }
      }
    }

    ctx.restore();
  }
}

// ---------- layouts ----------

export function orgLayout(coreId, departments) {
  const nodes = [{ id: coreId, x: 0.5, y: 0.46, r: 30, color: 'var(--accent)', label: 'Ядро', glyph: '◆', active: true, showLabel: true }];
  const edges = [];
  const n = departments.length;
  departments.forEach((d, i) => {
    const angle = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    const rad = d.kind === 'temporary' ? 0.37 : 0.33;
    const x = 0.5 + Math.cos(angle) * rad;
    const y = 0.46 + Math.sin(angle) * rad * 1.05;
    nodes.push({
      id: d.id, x, y, r: 24, color: d.color, label: d.name, glyph: d.name[0],
      sub: `${(d._agents || []).length} агентов`, dormant: d.status === 'dormant',
      kind: 'dept',
    });
    edges.push({ from: coreId, to: d.id });
  });
  departments.forEach((d) => {
    (d.bridges || []).forEach((toId) => {
      if (departments.find((x) => x.id === toId) && d.id < toId) {
        edges.push({ from: d.id, to: toId, dashed: true, width: 1.2 });
      }
    });
  });
  return { nodes, edges };
}

export function treeLayout(rootId, allNodes, parentOf) {
  const byParent = {};
  allNodes.forEach((n) => {
    const p = parentOf(n);
    if (!p) return;
    (byParent[p] = byParent[p] || []).push(n.id);
  });
  const depthOf = {};
  const order = [];
  (function walk(id, depth) {
    depthOf[id] = depth;
    order.push(id);
    (byParent[id] || []).forEach((c) => walk(c, depth + 1));
  })(rootId, 0);

  const maxDepth = Math.max(1, ...Object.values(depthOf));
  const countAtDepth = {};
  order.forEach((id) => { countAtDepth[depthOf[id]] = (countAtDepth[depthOf[id]] || 0) + 1; });
  const seenAtDepth = {};
  const positions = {};
  order.forEach((id) => {
    const depth = depthOf[id];
    seenAtDepth[depth] = (seenAtDepth[depth] || 0) + 1;
    const total = countAtDepth[depth];
    const x = 0.08 + (depth / maxDepth) * 0.82;
    const y = total === 1 ? 0.5 : 0.08 + ((seenAtDepth[depth] - 1) / (total - 1)) * 0.84;
    positions[id] = { x, y, depth };
  });
  return positions;
}
