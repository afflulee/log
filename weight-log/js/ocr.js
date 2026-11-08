// 체중계 사진에서 숫자 읽기
// 1순위: Claude API (설정에 API 키가 있을 때) — 7-세그먼트 LCD도 잘 읽음
// 2순위: Tesseract.js (기기 내 OCR, 키 불필요) — 정확도 낮음, 결과는 항상 사용자가 확인/수정

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const MIN_KG = 20;
const MAX_KG = 300;

/** 이미지 파일 → 축소된 JPEG data URL (전송/미리보기용). HEIC 등도 브라우저가 디코딩 가능하면 변환됨 */
export async function toJpeg(file, maxSide = 1280) {
  const bitmap = await loadImage(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), canvas };
}

async function loadImage(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* 아래 대체 경로 */
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 열 수 없습니다'));
    img.src = URL.createObjectURL(file);
  });
}

/** @returns {Promise<{weight:number|null, method:string, raw?:string}>} */
export async function recognizeWeight(jpeg, settings) {
  if (settings.apiKey) {
    try {
      return await recognizeWithClaude(jpeg.dataUrl, settings);
    } catch (err) {
      console.warn('Claude 인식 실패, 기기 OCR로 전환:', err);
    }
  }
  return recognizeWithTesseract(jpeg.canvas);
}

async function recognizeWithClaude(dataUrl, { apiKey, model }) {
  const base64 = dataUrl.split(',')[1];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model || 'claude-haiku-5-5',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            {
              type: 'text',
              text:
                'This is a photo of a bathroom scale display. Read the weight shown. ' +
                'Reply with JSON only, no other text: {"weight": <number or null>, "unit": "kg" | "lb"}. ' +
                'Use null if no weight is readable.',
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.map((c) => c.text || '').join('') || '';
  const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
  let w = Number(json.weight);
  if (!Number.isFinite(w) || json.weight === null) return { weight: null, method: 'Claude', raw: text };
  if (json.unit === 'lb') w = w * 0.45359237;
  return { weight: Math.round(w * 100) / 100, method: 'Claude', raw: text };
}

let tesseractLoading;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  tesseractLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error('OCR 엔진을 불러오지 못했습니다 (인터넷 연결 확인)'));
    document.head.appendChild(s);
  });
  return tesseractLoading;
}

async function recognizeWithTesseract(canvas) {
  const Tesseract = await loadTesseract();
  const worker = await Tesseract.createWorker('eng');
  try {
    await worker.setParameters({ tessedit_char_whitelist: '0123456789.,' });
    const variants = [binarize(canvas, false), binarize(canvas, true)];
    const candidates = [];
    let raw = '';
    for (const v of variants) {
      const { data } = await worker.recognize(v);
      raw += data.text + ' ';
      candidates.push(...extractNumbers(data.text));
    }
    return { weight: pickWeight(candidates), method: '기기 OCR', raw: raw.trim() };
  } finally {
    await worker.terminate();
  }
}

// 흑백 + 대비 강화 (invert=true: 어두운 바탕에 밝은 숫자인 디스플레이용)
function binarize(src, invert) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const px = img.data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  const mean = sum / (px.length / 4);
  for (let i = 0; i < px.length; i += 4) {
    const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    let v = y < mean * 0.85 ? 0 : 255;
    if (invert) v = 255 - v;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function extractNumbers(text) {
  const out = [];
  for (const m of text.replace(/,/g, '.').matchAll(/\d{2,3}(?:\.\d{1,2})?/g)) {
    let n = parseFloat(m[0]);
    // 소수점이 인식 안 된 경우 (예: 723 → 72.3)
    if (!m[0].includes('.') && n > MAX_KG && n < MAX_KG * 10) n = n / 10;
    if (n >= MIN_KG && n <= MAX_KG) out.push(n);
  }
  return out;
}

function pickWeight(nums) {
  if (!nums.length) return null;
  // 소수점 있는 값 우선, 그다음 가장 자주 나온 값
  const counts = new Map();
  for (const n of nums) counts.set(n, (counts.get(n) || 0) + 1 + (n % 1 !== 0 ? 0.5 : 0));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
