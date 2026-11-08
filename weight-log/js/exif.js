// JPEG EXIF에서 촬영 시각(DateTimeOriginal)만 읽는 최소 파서
// 앨범의 예전 사진을 넣을 때 "찍은 날짜"로 기록하기 위해 사용

const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME_DIGITIZED = 0x9004;
const TAG_DATETIME = 0x0132;

export async function readPhotoDate(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const d = parseJpegDate(new DataView(buf));
    if (d) return d;
  } catch {
    /* EXIF 없음 → 아래 대체값 */
  }
  return file.lastModified ? new Date(file.lastModified) : new Date();
}

function parseJpegDate(view) {
  if (view.getUint16(0) !== 0xffd8) return null; // JPEG 아님
  let offset = 2;
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset);
    const size = view.getUint16(offset + 2);
    if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) {
      return parseTiff(view, offset + 10);
    }
    if ((marker & 0xff00) !== 0xff00) break;
    offset += 2 + size;
  }
  return null;
}

function parseTiff(view, start) {
  const little = view.getUint16(start) === 0x4949;
  const u16 = (o) => view.getUint16(o, little);
  const u32 = (o) => view.getUint32(o, little);

  const readIfd = (ifdOffset) => {
    const tags = {};
    const base = start + ifdOffset;
    const count = u16(base);
    for (let i = 0; i < count; i++) {
      const e = base + 2 + i * 12;
      const tag = u16(e);
      const type = u16(e + 2);
      const num = u32(e + 4);
      if (type === 2) {
        const valOffset = num > 4 ? start + u32(e + 8) : e + 8;
        let s = '';
        for (let j = 0; j < num - 1; j++) s += String.fromCharCode(view.getUint8(valOffset + j));
        tags[tag] = s;
      } else if (type === 4) {
        tags[tag] = u32(e + 8);
      }
    }
    return tags;
  };

  const ifd0 = readIfd(u32(start + 4));
  let exif = {};
  if (ifd0[TAG_EXIF_IFD]) exif = readIfd(ifd0[TAG_EXIF_IFD]);
  const raw = exif[TAG_DATETIME_ORIGINAL] || exif[TAG_DATETIME_DIGITIZED] || ifd0[TAG_DATETIME];
  return raw ? parseExifDate(raw) : null;
}

// "2024:05:03 07:12:44" → Date (로컬 시각)
function parseExifDate(s) {
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isNaN(d.getTime()) ? null : d;
}
