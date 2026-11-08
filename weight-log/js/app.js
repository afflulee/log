import * as store from './store.js';
import { renderChart } from './chart.js';
import { readPhotoDate } from './exif.js';
import { toJpeg, recognizeWeight } from './ocr.js';

const $ = (s) => document.querySelector(s);
const DAY = 86400000;
const state = { period: 'week', offset: 0, editingId: null, photoItems: [] };

// ---------- 날짜 유틸 ----------
const pad2 = (n) => String(n).padStart(2, '0');
function toLocalInput(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 현재 선택된 기간의 [start, end) — 주는 월요일 시작, 달력 기준 */
function currentRange(entries) {
  const now = new Date();
  const o = state.offset;
  if (state.period === 'week') {
    const today = startOfDay(now);
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + o * 7);
    const end = new Date(monday);
    end.setDate(monday.getDate() + 7);
    return { start: monday, end, label: `${monday.getMonth() + 1}/${monday.getDate()} – ${new Date(end - DAY).getMonth() + 1}/${new Date(end - DAY).getDate()}` + (o === 0 ? ' · 이번 주' : '') };
  }
  if (state.period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth() + o, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return { start, end, label: `${start.getFullYear()}년 ${start.getMonth() + 1}월` };
  }
  if (state.period === 'year') {
    const start = new Date(now.getFullYear() + o, 0, 1);
    const end = new Date(start.getFullYear() + 1, 0, 1);
    return { start, end, label: `${start.getFullYear()}년` };
  }
  // 전체
  if (!entries.length) return { start: startOfDay(now), end: new Date(+startOfDay(now) + DAY), label: '전체 기간' };
  const first = startOfDay(new Date(entries[0].date));
  const last = new Date(+startOfDay(new Date(entries[entries.length - 1].date)) + DAY);
  const start = last - first < 7 * DAY ? new Date(last - 7 * DAY) : first;
  return { start, end: last, label: `전체 기간 · ${entries.length}개 기록` };
}

// ---------- 렌더 ----------
function render() {
  const all = store.getEntries();
  const settings = store.getSettings();
  const range = currentRange(all);
  const inRange = all.filter((e) => {
    const t = +new Date(e.date);
    return t >= +range.start && t < +range.end;
  });

  // 히어로
  const latest = all[all.length - 1];
  if (latest) {
    $('#hero-weight').textContent = latest.weight.toFixed(2);
    const prev = all[all.length - 2];
    const d = new Date(latest.date);
    let sub = `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    if (prev) sub += ` · 지난 기록 대비 ${signed(latest.weight - prev.weight)} kg`;
    if (settings.goal) sub += ` · 목표까지 ${Math.abs(latest.weight - settings.goal).toFixed(2)} kg`;
    $('#hero-sub').textContent = sub;
  } else {
    $('#hero-weight').textContent = '–';
    $('#hero-sub').textContent = '아래 버튼으로 첫 기록을 남겨 보세요';
  }

  // 기간 탭/내비
  for (const b of document.querySelectorAll('#period-tabs button'))
    b.setAttribute('aria-selected', String(b.dataset.period === state.period));
  $('#range-label').textContent = range.label;
  const isAll = state.period === 'all';
  $('#btn-prev').style.visibility = isAll ? 'hidden' : 'visible';
  $('#btn-next').style.visibility = isAll ? 'hidden' : 'visible';
  $('#btn-next').disabled = state.offset >= 0;

  // 그래프
  renderChart($('#chart'), {
    entries: inRange,
    start: range.start,
    end: range.end,
    period: state.period,
    goal: settings.goal,
  });

  // 통계
  const ws = inRange.map((e) => e.weight);
  const stats = $('#stats');
  if (ws.length) {
    const avg = ws.reduce((a, b) => a + b, 0) / ws.length;
    const change = ws[ws.length - 1] - ws[0];
    stats.innerHTML = [
      ['평균', avg.toFixed(2)],
      ['최저', Math.min(...ws).toFixed(2)],
      ['최고', Math.max(...ws).toFixed(2)],
      ['변화', signed(change)],
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}<small>kg</small></dd></div>`).join('');
  } else {
    stats.innerHTML = '';
  }

  // 목록 (선택된 기간, 최신순)
  const list = $('#entries');
  $('#list-count').textContent = inRange.length ? `${inRange.length}개` : '';
  if (!inRange.length) {
    list.innerHTML = `<li class="empty">${all.length ? '이 기간에는 기록이 없어요' : '기록이 없어요'}</li>`;
  } else {
    list.innerHTML = '';
    const rev = [...inRange].reverse();
    rev.forEach((e, i) => {
      const prev = rev[i + 1];
      const d = new Date(e.date);
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="e-main">
          <div class="e-weight">${e.weight.toFixed(2)}<small>kg</small></div>
          <div class="e-meta">${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. ${pad2(d.getHours())}:${pad2(d.getMinutes())}
            ${sourceBadge(e.source)}${e.note ? ` · ${escapeHtml(e.note)}` : ''}</div>
        </div>
        <div class="e-diff">${prev ? signed(e.weight - prev.weight) : ''}</div>
        <button class="icon-btn" data-edit="${e.id}" aria-label="수정">✎</button>`;
      list.appendChild(li);
    });
  }
}

function signed(n) {
  const v = Math.round(n * 100) / 100;
  return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(2);
}
function sourceBadge(s) {
  const map = { camera: '사진', album: '앨범', import: '가져옴' };
  return map[s] ? `<span class="badge">${map[s]}</span>` : '';
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- 직접 입력 / 수정 ----------
function openEntry(entry) {
  const f = $('#form-entry');
  state.editingId = entry?.id || null;
  $('#entry-title').textContent = entry ? '기록 수정' : '몸무게 입력';
  const last = store.getEntries().at(-1);
  f.weight.value = entry ? entry.weight : last ? last.weight : '';
  f.date.value = entry ? entry.date : toLocalInput(new Date());
  f.note.value = entry?.note || '';
  let del = f.querySelector('.btn-danger');
  if (entry && !del) {
    del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn-danger';
    del.textContent = '삭제';
    del.onclick = () => {
      if (!confirm('이 기록을 삭제할까요?')) return;
      store.deleteEntry(state.editingId);
      $('#dlg-entry').close();
      render();
      toast('삭제했어요');
    };
    f.querySelector('.dlg-actions').prepend(del);
  } else if (!entry && del) {
    del.remove();
  }
  $('#dlg-entry').showModal();
  f.weight.focus();
  f.weight.select();
}

$('#dlg-entry').addEventListener('close', () => {
  if ($('#dlg-entry').returnValue !== 'save') return;
  const f = $('#form-entry');
  const data = { weight: parseFloat(f.weight.value), date: f.date.value, note: f.note.value.trim() };
  if (!Number.isFinite(data.weight) || !data.date) return;
  if (state.editingId) store.updateEntry(state.editingId, data);
  else store.addEntry({ ...data, source: 'manual' });
  jumpTo(new Date(data.date));
  toast('저장했어요');
});

// ---------- 사진 입력 ----------
async function handlePhotos(files, source) {
  if (!files.length) return;
  const settings = store.getSettings();
  const listEl = $('#photo-list');
  listEl.innerHTML = '';
  state.photoItems = [];
  $('#photo-hint').textContent = settings.apiKey
    ? '숫자가 틀리면 고쳐 주세요. 날짜는 사진 촬영 시각이에요.'
    : '기기 OCR은 체중계 LCD 숫자를 잘 못 읽을 수 있어요. 설정에서 Claude API 키를 넣으면 정확해져요.';
  $('#dlg-photos').showModal();

  for (const file of files) {
    const row = document.createElement('div');
    row.className = 'photo-item';
    row.innerHTML = `
      <div class="thumb"></div>
      <div class="photo-fields">
        <label>체중 (kg)<input type="number" step="0.01" min="10" max="400" inputmode="decimal" placeholder="읽는 중…" /></label>
        <label>날짜<input type="datetime-local" /></label>
        <div class="muted small status">인식 중…</div>
      </div>
      <button type="button" class="icon-btn remove" aria-label="제외">✕</button>`;
    listEl.appendChild(row);
    const [wInput, dInput] = row.querySelectorAll('input');
    const item = { row, wInput, dInput, source, removed: false };
    state.photoItems.push(item);
    row.querySelector('.remove').onclick = () => {
      item.removed = true;
      row.remove();
    };

    // 사진 촬영 시각: 카메라로 방금 찍었으면 지금, 앨범이면 EXIF
    const date = source === 'camera' ? new Date() : await readPhotoDate(file);
    dInput.value = toLocalInput(date);
  }

  // 순서대로 인식 (OCR 엔진을 공유하고 API 동시호출을 피하기 위해)
  for (let i = 0; i < files.length; i++) {
    const item = state.photoItems[i];
    const status = item.row.querySelector('.status');
    try {
      const jpeg = await toJpeg(files[i]);
      item.row.querySelector('.thumb').style.backgroundImage = `url(${jpeg.dataUrl})`;
      const result = await recognizeWeight(jpeg, settings);
      if (result.weight != null) {
        if (!item.wInput.value) item.wInput.value = result.weight.toFixed(2);
        status.textContent = `${result.method}로 인식함`;
      } else {
        status.textContent = '숫자를 찾지 못했어요 — 직접 입력해 주세요';
      }
    } catch (err) {
      console.error(err);
      status.textContent = `인식 실패: ${err.message}`;
    }
    item.wInput.placeholder = '';
  }
}

$('#dlg-photos').addEventListener('close', () => {
  if ($('#dlg-photos').returnValue !== 'save') return;
  let saved = 0;
  let lastDate;
  for (const it of state.photoItems) {
    if (it.removed) continue;
    const w = parseFloat(it.wInput.value);
    if (!Number.isFinite(w) || !it.dInput.value) continue;
    store.addEntry({ weight: w, date: it.dInput.value, source: it.source });
    lastDate = new Date(it.dInput.value);
    saved++;
  }
  if (lastDate) jumpTo(lastDate);
  toast(saved ? `${saved}개 저장했어요` : '저장할 값이 없어요');
});

$('#input-camera').addEventListener('change', (e) => {
  handlePhotos([...e.target.files], 'camera');
  e.target.value = '';
});
$('#input-album').addEventListener('change', (e) => {
  handlePhotos([...e.target.files], 'album');
  e.target.value = '';
});

// 저장한 기록이 보이도록 해당 기간으로 이동
function jumpTo(date) {
  const now = new Date();
  if (state.period === 'week') {
    const mon = (d) => {
      const s = startOfDay(d);
      s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
      return s;
    };
    state.offset = Math.round((mon(date) - mon(now)) / (7 * DAY));
  } else if (state.period === 'month') {
    state.offset = (date.getFullYear() - now.getFullYear()) * 12 + date.getMonth() - now.getMonth();
  } else if (state.period === 'year') {
    state.offset = date.getFullYear() - now.getFullYear();
  }
  state.offset = Math.min(0, state.offset);
  render();
}

// ---------- 설정 / 백업 ----------
function openSettings() {
  const s = store.getSettings();
  const f = $('#form-settings');
  f.goal.value = s.goal ?? '';
  f.apiKey.value = s.apiKey;
  f.model.value = s.model;
  $('#dlg-settings').showModal();
}
$('#dlg-settings').addEventListener('close', () => {
  if ($('#dlg-settings').returnValue !== 'save') return;
  const f = $('#form-settings');
  const goal = parseFloat(f.goal.value);
  store.saveSettings({ goal: Number.isFinite(goal) ? goal : null, apiKey: f.apiKey.value.trim(), model: f.model.value });
  render();
  toast('설정을 저장했어요');
});

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 10);

$('#btn-export-json').onclick = () =>
  download(`weight-log-${stamp()}.json`, JSON.stringify({ app: 'weight-log', version: 1, entries: store.getEntries() }, null, 2), 'application/json');
$('#btn-export-csv').onclick = () => {
  const rows = store.getEntries().map((e) => [e.date.replace('T', ' '), e.weight, e.source, `"${(e.note || '').replace(/"/g, '""')}"`].join(','));
  download(`weight-log-${stamp()}.csv`, '﻿date,weight_kg,source,note\n' + rows.join('\n'), 'text/csv');
};
$('#input-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    let items;
    if (file.name.endsWith('.csv')) {
      items = text.replace(/^﻿/, '').split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
        const [date, weight, source, ...note] = line.split(',');
        return { date: date.trim().replace(' ', 'T'), weight, source, note: note.join(',').replace(/^"|"$/g, '').replace(/""/g, '"') };
      });
    } else {
      const json = JSON.parse(text);
      items = Array.isArray(json) ? json : json.entries;
    }
    const n = store.importEntries(items || []);
    render();
    toast(`${n}개 가져왔어요`);
  } catch (err) {
    alert(`가져오기 실패: ${err.message}`);
  }
});
$('#btn-clear').onclick = () => {
  if (!confirm('모든 기록을 삭제할까요? 되돌릴 수 없어요.\n(먼저 내보내기로 백업하는 걸 추천해요)')) return;
  for (const e of store.getEntries()) store.deleteEntry(e.id);
  $('#dlg-settings').close();
  render();
  toast('전체 삭제했어요');
};

// ---------- 이벤트 ----------
$('#btn-manual').onclick = () => openEntry(null);
$('#btn-settings').onclick = openSettings;
$('#period-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-period]');
  if (!b) return;
  state.period = b.dataset.period;
  state.offset = 0;
  render();
});
$('#btn-prev').onclick = () => {
  state.offset--;
  render();
};
$('#btn-next').onclick = () => {
  state.offset = Math.min(0, state.offset + 1);
  render();
};
$('#entries').addEventListener('click', (e) => {
  const b = e.target.closest('[data-edit]');
  if (!b) return;
  openEntry(store.getEntries().find((x) => x.id === b.dataset.edit));
});

let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 80);
}).observe($('#chart'));

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
