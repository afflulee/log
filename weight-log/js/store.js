// 기록 저장소 — 브라우저 localStorage에 저장 (기기 안에만 보관)
const KEY = 'weightlog.entries.v1';
const SETTINGS_KEY = 'weightlog.settings.v1';

function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/** entry: { id, date: 'YYYY-MM-DDTHH:mm' (로컬 시각), weight: kg, source: 'manual'|'camera'|'album', note } */
export function getEntries() {
  const list = readJSON(KEY, []);
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

function saveEntries(list) {
  writeJSON(KEY, list);
}

export function addEntry({ date, weight, source = 'manual', note = '' }) {
  const list = getEntries();
  const entry = { id: uid(), date, weight: round1(weight), source, note };
  list.push(entry);
  saveEntries(list);
  return entry;
}

export function updateEntry(id, patch) {
  const list = getEntries();
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return;
  list[i] = { ...list[i], ...patch, weight: round1(patch.weight ?? list[i].weight) };
  saveEntries(list);
}

export function deleteEntry(id) {
  saveEntries(getEntries().filter((e) => e.id !== id));
}

/** 가져오기: 같은 시각+같은 체중은 중복으로 보고 건너뜀 */
export function importEntries(items) {
  const list = getEntries();
  const seen = new Set(list.map((e) => `${e.date}|${e.weight}`));
  let added = 0;
  for (const it of items) {
    const w = Number(it.weight);
    if (!it.date || !Number.isFinite(w)) continue;
    const date = String(it.date).slice(0, 16);
    const k = `${date}|${round1(w)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    list.push({ id: uid(), date, weight: round1(w), source: it.source || 'import', note: it.note || '' });
    added++;
  }
  saveEntries(list);
  return added;
}

export function getSettings() {
  return { apiKey: '', model: 'claude-haiku-5-5', goal: null, ...readJSON(SETTINGS_KEY, {}) };
}

export function saveSettings(patch) {
  writeJSON(SETTINGS_KEY, { ...getSettings(), ...patch });
}

export function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}
