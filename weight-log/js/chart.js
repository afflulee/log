// 의존성 없는 SVG 선 그래프 (단일 시리즈 + 목표선 + 호버 툴팁)
const NS = 'http://www.w3.org/2000/svg';
const DAY = 86400000;

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function niceStep(span, count) {
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
}

const fmtDay = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function xTicks(start, end, period) {
  const ticks = [];
  const s = new Date(start);
  if (period === 'week') {
    for (let t = new Date(s); t < end; t.setDate(t.getDate() + 1))
      ticks.push({ t: +t, label: `${WEEKDAYS[t.getDay()]} ${t.getDate()}` });
  } else if (period === 'month') {
    for (let t = new Date(s); t < end; t.setDate(t.getDate() + 1))
      if (t.getDate() === 1 || t.getDate() % 5 === 0) ticks.push({ t: +t, label: `${t.getDate()}일` });
  } else {
    const spanDays = (end - start) / DAY;
    const monthStep = spanDays <= 400 ? 1 : spanDays <= 800 ? 3 : spanDays <= 2000 ? 6 : 12;
    const t = new Date(s.getFullYear(), s.getMonth() + (s.getDate() > 1 ? 1 : 0), 1);
    for (; t <= end; t.setMonth(t.getMonth() + 1)) {
      if (t.getMonth() % monthStep !== 0) continue;
      const label = monthStep >= 12 || t.getMonth() === 0 ? `${t.getFullYear()}` : `${t.getMonth() + 1}월`;
      ticks.push({ t: +t, label });
    }
  }
  return ticks;
}

/**
 * @param {HTMLElement} host
 * @param {{entries:{date:string,weight:number}[], start:Date, end:Date, period:string, goal:number|null}} opts
 */
export function renderChart(host, { entries, start, end, period, goal }) {
  host.innerHTML = '';
  const width = Math.max(280, host.clientWidth);
  const height = Math.round(Math.min(340, Math.max(220, width * 0.55)));
  const m = { top: 16, right: 16, bottom: 30, left: 40 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;

  const pts = entries.map((e) => ({ t: +new Date(e.date), w: e.weight, e }));
  if (!pts.length) {
    host.innerHTML = '<div class="chart-empty">이 기간에는 기록이 없어요</div>';
    return;
  }

  const t0 = +start;
  const t1 = +end;
  let lo = Math.min(...pts.map((p) => p.w));
  let hi = Math.max(...pts.map((p) => p.w));
  if (goal) {
    lo = Math.min(lo, goal);
    hi = Math.max(hi, goal);
  }
  const pad = Math.max(0.5, (hi - lo) * 0.15);
  const step = niceStep(hi - lo + pad * 2, 4);
  const y0 = Math.floor((lo - pad) / step) * step;
  const y1 = Math.ceil((hi + pad) / step) * step;

  const sx = (t) => m.left + ((t - t0) / (t1 - t0 || 1)) * iw;
  const sy = (w) => m.top + ih - ((w - y0) / (y1 - y0 || 1)) * ih;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', class: 'chart' });
  el('title', {}, svg).textContent = '체중 변화 그래프';

  // 격자 + y축 라벨
  const grid = el('g', { class: 'grid' }, svg);
  for (let v = y0; v <= y1 + 1e-9; v += step) {
    const y = sy(v);
    el('line', { x1: m.left, x2: width - m.right, y1: y, y2: y }, grid);
    const label = el('text', { x: m.left - 8, y: y + 4, 'text-anchor': 'end', class: 'axis-label' }, grid);
    label.textContent = Number.isInteger(step) ? v.toFixed(0) : v.toFixed(1);
  }

  // x축 라벨
  const ticks = xTicks(start, end, period);
  const minGap = 34;
  let lastX = -Infinity;
  for (const tk of ticks) {
    const x = sx(tk.t);
    if (x - lastX < minGap) continue;
    lastX = x;
    const tx = el('text', { x, y: height - 8, 'text-anchor': 'middle', class: 'axis-label' }, svg);
    tx.textContent = tk.label;
  }

  // 목표선
  if (goal) {
    const y = sy(goal);
    el('line', { x1: m.left, x2: width - m.right, y1: y, y2: y, class: 'goal-line' }, svg);
    const gl = el('text', { x: width - m.right, y: y - 6, 'text-anchor': 'end', class: 'goal-label' }, svg);
    gl.textContent = `목표 ${goal}kg`;
  }

  // 선
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)},${sy(p.w).toFixed(1)}`).join('');
  el('path', { d, class: 'series-line' }, svg);

  // 점 (많으면 생략)
  if (pts.length <= 62) {
    for (const p of pts) el('circle', { cx: sx(p.t), cy: sy(p.w), r: 4, class: 'series-dot' }, svg);
  }

  // 마지막 값 직접 표시
  const last = pts[pts.length - 1];
  const lx = sx(last.t);
  const ll = el('text', {
    x: Math.min(lx, width - m.right),
    y: sy(last.w) - 10,
    'text-anchor': lx > width - 60 ? 'end' : 'middle',
    class: 'last-label',
  }, svg);
  ll.textContent = `${last.w.toFixed(1)}`;

  // 호버: 크로스헤어 + 툴팁
  const cross = el('line', { y1: m.top, y2: m.top + ih, class: 'crosshair', visibility: 'hidden' }, svg);
  const focus = el('circle', { r: 6, class: 'focus-dot', visibility: 'hidden' }, svg);
  const hit = el('rect', { x: m.left, y: 0, width: iw, height: height, fill: 'transparent' }, svg);
  host.appendChild(svg);

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  host.appendChild(tip);

  const show = (ev) => {
    const rect = svg.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * width;
    let best = pts[0];
    for (const p of pts) if (Math.abs(sx(p.t) - x) < Math.abs(sx(best.t) - x)) best = p;
    const px = sx(best.t);
    const py = sy(best.w);
    cross.setAttribute('x1', px);
    cross.setAttribute('x2', px);
    focus.setAttribute('cx', px);
    focus.setAttribute('cy', py);
    cross.setAttribute('visibility', 'visible');
    focus.setAttribute('visibility', 'visible');
    const dt = new Date(best.t);
    tip.innerHTML = `<b>${best.w.toFixed(1)} kg</b><span>${dt.getFullYear()}. ${fmtDay(dt)} (${WEEKDAYS[dt.getDay()]}) ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}</span>`;
    tip.hidden = false;
    const scale = rect.width / width;
    const tipW = tip.offsetWidth;
    let left = px * scale + 12;
    if (left + tipW > rect.width) left = px * scale - tipW - 12;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, py * scale - 50)}px`;
  };
  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    focus.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}
