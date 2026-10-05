/* xlsx.ts — 의존성 없는 최소 XLSX 생성기 (Cloudflare Workers 호환)
   ZIP은 무압축(STORED)으로 쓰고, 서식은 styles.xml에 직접 정의합니다.
   주간업무보고 양식(병합·열너비·테두리·맑은 고딕)을 그대로 재현하기 위한 용도. */

/* ── CRC32 ─────────────────────────────────────────────────── */
let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}
function crc32(buf: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ── ZIP (STORED) ──────────────────────────────────────────── */
type ZipEntry = { name: string; data: Uint8Array };
const enc = new TextEncoder();

function zip(entries: ZipEntry[]): Uint8Array {
  const DOS_TIME = 0;
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01 고정
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameB = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;

    const lh = new Uint8Array(30 + nameB.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameB.length, true);
    lv.setUint16(28, 0, true);
    lh.set(nameB, 30);
    locals.push(lh, e.data);

    const ch = new Uint8Array(46 + nameB.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameB, 46);
    centrals.push(ch);

    offset += lh.length + size;
  }

  const cdSize = centrals.reduce((a, b) => a + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const b of locals) { out.set(b, p); p += b.length; }
  for (const b of centrals) { out.set(b, p); p += b.length; }
  out.set(eocd, p);
  return out;
}

/* ── XML 이스케이프 ────────────────────────────────────────── */
export function xe(s: string): string {
  return (s ?? "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/\r/g, "").replace(/\n/g, "&#10;")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

/* ── 스타일 인덱스 (cellXfs 순서와 일치) ───────────────────── */
export const S = {
  PLAIN: 0,
  TITLE: 1,
  SUBTITLE: 2,
  HEAD: 3,
  CENTER: 4,
  CENTER_W: 5,
  TOP_W: 6,
  LEFT_TOP_W: 7,
} as const;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="11"/><color rgb="FF000000"/><name val="맑은 고딕"/><family val="2"/><charset val="129"/></font>
<font><sz val="24"/><color rgb="FF000000"/><name val="맑은 고딕"/><family val="2"/><charset val="129"/></font>
<font><sz val="14"/><color rgb="FF000000"/><name val="맑은 고딕"/><family val="2"/><charset val="129"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD0CECE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFACB9CA"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="4">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>
<border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top/><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="표준" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/* ── 시트 조립 ─────────────────────────────────────────────── */
export type Cell = { c: number; v: string | number | null; s?: number };
export type Row = { r: number; ht?: number; cells: Cell[] };

function colName(n: number): string {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = ((n - m) / 26) | 0; }
  return s;
}

export function buildWorkbook(opts: {
  sheetName: string;
  cols: { min: number; max: number; width: number }[];
  rows: Row[];
  merges: string[];
}): Uint8Array {
  const colsXml = opts.cols.length
    ? `<cols>${opts.cols.map(c => `<col min="${c.min}" max="${c.max}" width="${c.width}" customWidth="1"/>`).join("")}</cols>`
    : "";

  const rowsXml = opts.rows.map(r => {
    const cells = r.cells.map(c => {
      const ref = colName(c.c) + r.r;
      const st = c.s ? ` s="${c.s}"` : "";
      if (c.v === null || c.v === "") return `<c r="${ref}"${st}/>`;
      if (typeof c.v === "number") return `<c r="${ref}"${st}><v>${c.v}</v></c>`;
      return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xe(c.v)}</t></is></c>`;
    }).join("");
    const ht = r.ht ? ` ht="${r.ht}" customHeight="1"` : "";
    return `<row r="${r.r}"${ht}>${cells}</row>`;
  }).join("");

  const mergeXml = opts.merges.length
    ? `<mergeCells count="${opts.merges.length}">${opts.merges.map(m => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetFormatPr defaultRowHeight="16.5"/>${colsXml}<sheetData>${rowsXml}</sheetData>${mergeXml}<pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;

  const sn = xe(opts.sheetName.replace(/[:\\\/?*\[\]]/g, "-").slice(0, 31));

  const files: ZipEntry[] = [
    { name: "[Content_Types].xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) },
    { name: "_rels/.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sn}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: "xl/styles.xml", data: enc.encode(STYLES) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheet) },
  ];
  return zip(files);
}
