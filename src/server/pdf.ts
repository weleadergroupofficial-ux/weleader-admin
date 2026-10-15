import { readFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { BRAND, OPS_TEAM, seoulStamp, type CellValue, type Column, type ExportDoc, type SheetSpec } from "./xlsx";

/**
 * 외부 라이브러리 없이 만드는 PDF 작성기 (A4 가로).
 * - Pretendard(OpenType/CFF) 글꼴을 PDF 에 포함해 한글이 어느 환경에서나 같게 보입니다.
 * - 엑셀과 같은 ExportDoc(표 데이터)을 받아 머리글·줄무늬·합계 행이 있는 표로 그립니다.
 */

// ---------------------------------------------------------------------
// 자원(글꼴·로고) 읽기
// ---------------------------------------------------------------------

const cache = new Map<string, Buffer>();

// 폰트(1.5MB)를 요청마다 다시 압축하면 CPU 를 오래 쓰고 다른 요청이 줄줄이 밀리므로, 한 번만 압축해 재사용합니다.
const deflatedCache = new WeakMap<Uint8Array, Buffer>();
function deflatedFont(data: Uint8Array): Buffer {
  let hit = deflatedCache.get(data);
  if (!hit) {
    hit = deflateSync(data, { level: 6 });
    deflatedCache.set(data, hit);
  }
  return hit;
}

async function asset(name: string, origin: string): Promise<Buffer> {
  const hit = cache.get(name);
  if (hit) return hit;
  let buf: Buffer | null = null;
  try {
    buf = await readFile(path.join(process.cwd(), "public", "pdf", name));
  } catch {
    /* 서버리스 환경에서는 정적 파일이 함수 안에 없을 수 있어 주소로 다시 받습니다 */
  }
  if (!buf) {
    const res = await fetch(`${origin}/pdf/${name}`, { cache: "force-cache" });
    if (!res.ok) throw new Error(`PDF 자원을 불러오지 못했습니다: ${name}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  cache.set(name, buf);
  return buf;
}

// ---------------------------------------------------------------------
// OpenType(CFF) 글꼴 판독: 글리프 번호·폭
// ---------------------------------------------------------------------

class OtfFont {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  bbox: [number, number, number, number];
  private numGlyphs: number;
  private numHMetrics: number;
  private hmtx: number;
  private cmap: (cp: number) => number;

  constructor(
    public data: Buffer,
    public name: string,
  ) {
    const tables = new Map<string, { off: number; len: number }>();
    const n = data.readUInt16BE(4);
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16;
      tables.set(data.toString("latin1", o, o + 4), { off: data.readUInt32BE(o + 8), len: data.readUInt32BE(o + 12) });
    }
    const need = (t: string) => {
      const v = tables.get(t);
      if (!v) throw new Error(`글꼴 표 누락: ${t}`);
      return v;
    };
    const head = need("head");
    this.unitsPerEm = data.readUInt16BE(head.off + 18);
    this.bbox = [data.readInt16BE(head.off + 36), data.readInt16BE(head.off + 38), data.readInt16BE(head.off + 40), data.readInt16BE(head.off + 42)];
    const hhea = need("hhea");
    this.ascent = data.readInt16BE(hhea.off + 4);
    this.descent = data.readInt16BE(hhea.off + 6);
    this.numHMetrics = data.readUInt16BE(hhea.off + 34);
    this.numGlyphs = data.readUInt16BE(need("maxp").off + 4);
    this.hmtx = need("hmtx").off;
    this.cmap = this.buildCmap(need("cmap").off);
  }

  private buildCmap(off: number): (cp: number) => number {
    const d = this.data;
    const count = d.readUInt16BE(off + 2);
    let best: { off: number; fmt: number } | null = null;
    for (let i = 0; i < count; i++) {
      const pid = d.readUInt16BE(off + 4 + i * 8);
      const eid = d.readUInt16BE(off + 6 + i * 8);
      const so = off + d.readUInt32BE(off + 8 + i * 8);
      const fmt = d.readUInt16BE(so);
      const ok = (pid === 3 && eid === 10 && fmt === 12) || (pid === 0 && fmt === 12) || (pid === 3 && eid === 1 && fmt === 4) || (pid === 0 && fmt === 4);
      if (!ok) continue;
      if (!best || fmt === 12) best = { off: so, fmt };
    }
    if (!best) throw new Error("글꼴에서 유니코드 매핑을 찾을 수 없습니다.");
    const so = best.off;
    if (best.fmt === 12) {
      const groups = d.readUInt32BE(so + 12);
      return (cp) => {
        let lo = 0;
        let hi = groups - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const g = so + 16 + mid * 12;
          const s = d.readUInt32BE(g);
          const e = d.readUInt32BE(g + 4);
          if (cp < s) hi = mid - 1;
          else if (cp > e) lo = mid + 1;
          else return d.readUInt32BE(g + 8) + (cp - s);
        }
        return 0;
      };
    }
    const segX2 = d.readUInt16BE(so + 6);
    const endO = so + 14;
    const startO = endO + segX2 + 2;
    const deltaO = startO + segX2;
    const rangeO = deltaO + segX2;
    return (cp) => {
      if (cp > 0xffff) return 0;
      for (let i = 0; i < segX2; i += 2) {
        if (cp > d.readUInt16BE(endO + i)) continue;
        const s = d.readUInt16BE(startO + i);
        if (cp < s) return 0;
        const ro = d.readUInt16BE(rangeO + i);
        const delta = d.readInt16BE(deltaO + i);
        if (ro === 0) return (cp + delta) & 0xffff;
        const g = d.readUInt16BE(rangeO + i + ro + (cp - s) * 2);
        return g === 0 ? 0 : (g + delta) & 0xffff;
      }
      return 0;
    };
  }

  glyph(cp: number): number {
    const g = this.cmap(cp);
    return g < this.numGlyphs ? g : 0;
  }

  /** 글리프 폭 (1000 단위) */
  width(gid: number): number {
    const i = Math.min(gid, this.numHMetrics - 1);
    return Math.round((this.data.readUInt16BE(this.hmtx + i * 4) * 1000) / this.unitsPerEm);
  }
}

// ---------------------------------------------------------------------
// PDF 개체 조립
// ---------------------------------------------------------------------

class Pdf {
  private objs: Buffer[] = [];
  reserve(): number {
    this.objs.push(Buffer.alloc(0));
    return this.objs.length;
  }
  set(id: number, body: string | Buffer) {
    const head = Buffer.from(`${id} 0 obj\n`, "latin1");
    const tail = Buffer.from(`\nendobj\n`, "latin1");
    this.objs[id - 1] = Buffer.concat([head, typeof body === "string" ? Buffer.from(body, "latin1") : body, tail]);
  }
  add(body: string | Buffer): number {
    const id = this.reserve();
    this.set(id, body);
    return id;
  }
  stream(dict: string, data: Buffer): number {
    return this.add(Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream", "latin1")]));
  }
  build(root: number, info: number): Uint8Array {
    const parts: Buffer[] = [Buffer.from("%PDF-1.6\n%\xE2\xE3\xCF\xD3\n", "latin1")];
    let pos = parts[0].length;
    const offsets: number[] = [];
    for (const o of this.objs) {
      offsets.push(pos);
      parts.push(o);
      pos += o.length;
    }
    let xref = `xref\n0 ${this.objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) xref += `${String(o).padStart(10, "0")} 00000 n \n`;
    xref += `trailer\n<< /Size ${this.objs.length + 1} /Root ${root} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
    parts.push(Buffer.from(xref, "latin1"));
    return new Uint8Array(Buffer.concat(parts));
  }
}

const hex4 = (n: number) => n.toString(16).padStart(4, "0");
const utf16hex = (s: string) => "FEFF" + Array.from(s, (c) => hex4(c.codePointAt(0)! > 0xffff ? 0x3f : c.codePointAt(0)!)).join("").toUpperCase();
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

function rgb(hex: string): string {
  const v = parseInt(hex, 16);
  return `${n2(((v >> 16) & 255) / 255)} ${n2(((v >> 8) & 255) / 255)} ${n2((v & 255) / 255)}`;
}

// ---------------------------------------------------------------------
// 글꼴 개체 (Type0 / CIDFontType0)
// ---------------------------------------------------------------------

class FontRef {
  used = new Map<number, number>(); // gid → code point
  constructor(
    public font: OtfFont,
    public res: string,
  ) {}

  encode(text: string): { hex: string; width: number } {
    let hex = "";
    let w = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      let gid = this.font.glyph(cp);
      if (!gid) gid = this.font.glyph(0x20);
      hex += hex4(gid);
      w += this.font.width(gid);
      if (gid && !this.used.has(gid)) this.used.set(gid, cp);
    }
    return { hex, width: w };
  }
  measure(text: string, size: number): number {
    let w = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      w += this.font.width(this.font.glyph(cp) || this.font.glyph(0x20));
    }
    return (w * size) / 1000;
  }

  write(pdf: Pdf, id: number) {
    const f = this.font;
    const file = pdf.stream("/Subtype /OpenType /Filter /FlateDecode", deflatedFont(f.data));
    const k = 1000 / f.unitsPerEm;
    const desc = pdf.add(
      `<< /Type /FontDescriptor /FontName /${f.name} /Flags 4 /FontBBox [${f.bbox.map((v) => Math.round(v * k)).join(" ")}] /ItalicAngle 0 ` +
        `/Ascent ${Math.round(f.ascent * k)} /Descent ${Math.round(f.descent * k)} /CapHeight ${Math.round(f.ascent * k * 0.8)} /StemV 80 /FontFile3 ${file} 0 R >>`,
    );
    const gids = [...this.used.keys()].sort((a, b) => a - b);
    const w = gids.map((g) => `${g} [${f.width(g)}]`).join(" ");
    const cid = pdf.add(
      `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /${f.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
        `/FontDescriptor ${desc} 0 R /DW 1000 /W [${w}] >>`,
    );
    let cmap =
      "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Adobe-Identity-UCS def /CMapType 2 def " +
      "1 begincodespacerange <0000> <FFFF> endcodespacerange\n";
    for (let i = 0; i < gids.length; i += 100) {
      const chunk = gids.slice(i, i + 100);
      cmap += `${chunk.length} beginbfchar\n`;
      for (const g of chunk) {
        const cp = this.used.get(g)!;
        const u = cp > 0xffff ? `${hex4(0xd800 + ((cp - 0x10000) >> 10))}${hex4(0xdc00 + ((cp - 0x10000) & 0x3ff))}` : hex4(cp);
        cmap += `<${hex4(g)}> <${u}>\n`;
      }
      cmap += "endbfchar\n";
    }
    cmap += "endcmap CMapName currentdict /CMap defineresource pop end end";
    const tu = pdf.stream("/Filter /FlateDecode", deflateSync(Buffer.from(cmap, "latin1")));
    pdf.set(id, `<< /Type /Font /Subtype /Type0 /BaseFont /${f.name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R >>`);
  }
}

// ---------------------------------------------------------------------
// 로고 (RGB PNG → PDF 이미지)
// ---------------------------------------------------------------------

function pngImage(pdf: Pdf, png: Buffer): { id: number; w: number; h: number } {
  if (png.toString("latin1", 1, 4) !== "PNG") throw new Error("로고 형식 오류");
  let off = 8;
  let w = 0;
  let h = 0;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("latin1", off + 4, off + 8);
    const body = png.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 2 || body[12] !== 0) throw new Error("로고는 8비트 RGB(비인터레이스) PNG 여야 합니다.");
    } else if (type === "IDAT") idat.push(body);
    off += 12 + len;
  }
  const id = pdf.stream(
    `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${w} >>`,
    Buffer.concat(idat),
  );
  return { id, w, h };
}

// ---------------------------------------------------------------------
// 페이지 그리기
// ---------------------------------------------------------------------

const PW = 841.89;
const PH = 595.28;
const MX = 36;
const TOP_FIRST = 36;
const TOP_NEXT = 70;
const BOTTOM = 44;
const PINK = "E5007E";

interface Ctx {
  pdf: Pdf;
  reg: FontRef;
  bold: FontRef;
  logo: { w: number; h: number };
  pages: string[][];
  ops: string[];
  y: number; // 위에서부터의 현재 위치
  doc: ExportDoc;
  generated: string;
}

function fmtCell(v: CellValue, col: Column): string {
  if (v == null || v === "") return "";
  if (v instanceof Date) return seoulStamp(v);
  if (typeof v === "object") v = v.value;
  if (typeof v === "number") {
    if (col.type === "percent") return `${Math.round(v * 100)}%`;
    return v.toLocaleString("ko-KR");
  }
  return String(v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

function wrap(font: FontRef, text: string, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    const flush = () => {
      out.push(line);
      line = "";
    };
    for (const word of para.split(/(?<= )/)) {
      if (font.measure(line + word, size) <= maxW) {
        line += word;
        continue;
      }
      if (line.trim()) flush();
      if (font.measure(word, size) <= maxW) {
        line = word;
        continue;
      }
      for (const ch of word) {
        if (font.measure(line + ch, size) > maxW && line) flush();
        line += ch;
      }
    }
    out.push(line);
  }
  return out.map((l) => l.replace(/\s+$/, ""));
}

function put(c: Ctx, s: string) {
  c.ops.push(s);
}

function rect(c: Ctx, x: number, top: number, w: number, h: number, fill: string) {
  put(c, `${rgb(fill)} rg ${n2(x)} ${n2(PH - top - h)} ${n2(w)} ${n2(h)} re f`);
}

function roundRect(c: Ctx, x: number, top: number, w: number, h: number, r: number, fill: string) {
  const y = PH - top - h;
  const k = r * 0.5523;
  put(
    c,
    `${rgb(fill)} rg ${n2(x + r)} ${n2(y)} m ${n2(x + w - r)} ${n2(y)} l ${n2(x + w - r + k)} ${n2(y)} ${n2(x + w)} ${n2(y + r - k)} ${n2(x + w)} ${n2(y + r)} c ` +
      `${n2(x + w)} ${n2(y + h - r)} l ${n2(x + w)} ${n2(y + h - r + k)} ${n2(x + w - r + k)} ${n2(y + h)} ${n2(x + w - r)} ${n2(y + h)} c ` +
      `${n2(x + r)} ${n2(y + h)} l ${n2(x + r - k)} ${n2(y + h)} ${n2(x)} ${n2(y + h - r + k)} ${n2(x)} ${n2(y + h - r)} c ` +
      `${n2(x)} ${n2(y + r)} l ${n2(x)} ${n2(y + r - k)} ${n2(x + r - k)} ${n2(y)} ${n2(x + r)} ${n2(y)} c f`,
  );
}

function hline(c: Ctx, x1: number, x2: number, top: number, color: string, width = 0.5) {
  put(c, `${rgb(color)} RG ${width} w ${n2(x1)} ${n2(PH - top)} m ${n2(x2)} ${n2(PH - top)} l S`);
}

type Align = "left" | "right" | "center";

function text(c: Ctx, f: FontRef, size: number, x: number, baselineTop: number, str: string, color: string, align: Align = "left", boxW = 0) {
  if (!str) return;
  const { hex } = f.encode(str);
  let px = x;
  if (align !== "left") {
    const w = f.measure(str, size);
    px = align === "right" ? x + boxW - w : x + (boxW - w) / 2;
  }
  put(c, `BT ${f.res} ${n2(size)} Tf ${rgb(color)} rg ${n2(px)} ${n2(PH - baselineTop)} Td <${hex}> Tj ET`);
}

function chrome(c: Ctx, first: boolean) {
  // 상단 띠: 로고 보라 + 포인트 핑크
  rect(c, 0, 0, PW, 7, BRAND.deep);
  rect(c, 0, 0, 150, 7, PINK);
  if (!first) {
    const lh = 26;
    const lw = (c.logo.w / c.logo.h) * lh;
    put(c, `q ${n2(lw)} 0 0 ${n2(lh)} ${MX} ${n2(PH - 22 - lh)} cm /Im1 Do Q`);
    text(c, c.bold, 9.5, PW - MX - 400, 38, c.doc.title, BRAND.deep, "right", 400);
    text(c, c.reg, 8, PW - MX - 400, 50, c.doc.subtitle ?? "", BRAND.muted, "right", 400);
    hline(c, MX, PW - MX, 62, BRAND.line, 0.8);
  }
}

function newPage(c: Ctx, first = false) {
  c.ops = [];
  c.pages.push(c.ops);
  chrome(c, first);
  c.y = first ? TOP_FIRST : TOP_NEXT;
}

function cover(c: Ctx) {
  const lh = 46;
  const lw = (c.logo.w / c.logo.h) * lh;
  put(c, `q ${n2(lw)} 0 0 ${n2(lh)} ${MX} ${n2(PH - TOP_FIRST - 6 - lh)} cm /Im1 Do Q`);
  text(c, c.reg, 8.5, PW - MX - 300, TOP_FIRST + 18, `생성 ${c.generated}`, BRAND.muted, "right", 300);
  text(c, c.reg, 8.5, PW - MX - 300, TOP_FIRST + 31, OPS_TEAM, BRAND.muted, "right", 300);

  let y = TOP_FIRST + 6 + lh + 30;
  text(c, c.bold, 25, MX, y, c.doc.title, BRAND.deep);
  y += 20;
  text(c, c.reg, 10.5, MX, y, c.doc.subtitle ?? "", BRAND.muted);
  y += 16;

  const kpis = c.doc.kpis ?? [];
  if (kpis.length) {
    const gap = 10;
    const bw = Math.min(190, (PW - 2 * MX - gap * (kpis.length - 1)) / kpis.length);
    kpis.forEach(([k, v], i) => {
      const x = MX + i * (bw + gap);
      roundRect(c, x, y, bw, 46, 6, BRAND.zebra);
      rect(c, x, y + 9, 3, 28, PINK);
      text(c, c.reg, 8.5, x + 14, y + 17, k, BRAND.muted);
      text(c, c.bold, 15, x + 14, y + 36, v, BRAND.deep);
    });
    y += 46 + 14;
  }
  c.y = y;
}

function footer(c: Ctx, page: number, total: number, ops: string[]) {
  const saved = c.ops;
  c.ops = ops;
  hline(c, MX, PW - MX, PH - 28, BRAND.line, 0.6);
  text(c, c.reg, 7.5, MX, PH - 16, `BEAUTY WAVE in INCHEON 2026 · ${OPS_TEAM}`, BRAND.muted);
  text(c, c.reg, 7.5, PW - MX - 200, PH - 16, `${page} / ${total}`, BRAND.muted, "right", 200);
  c.ops = saved;
}

function drawSheet(c: Ctx, sheet: SheetSpec, firstOnPage: boolean) {
  const cols = sheet.columns;
  const n = cols.length;
  const size = n >= 12 ? 7.2 : n >= 9 ? 7.8 : n >= 6 ? 8.6 : 9.6;
  const headSize = size - 0.2;
  const pad = 5;
  const lineH = size * 1.45;
  const avail = PW - 2 * MX;
  const totalW = cols.reduce((a, col) => a + (col.width ?? 14), 0);
  const widths = cols.map((col) => ((col.width ?? 14) / totalW) * avail);
  const xs: number[] = [];
  widths.reduce((acc, w, i) => ((xs[i] = acc), acc + w), MX);

  const heading = () => {
    rect(c, MX, c.y - 9, 4, 12, PINK);
    text(c, c.bold, 12, MX + 11, c.y + 1, sheet.heading ?? sheet.name, BRAND.deep);
    c.y += 12;
  };
  const header = () => {
    const lines = cols.map((col, i) => wrap(c.bold, col.header, headSize, widths[i] - 2 * pad));
    const h = Math.max(...lines.map((l) => l.length)) * headSize * 1.35 + 12;
    rect(c, MX, c.y, avail, h, BRAND.deep);
    cols.forEach((_, i) => {
      const hh = lines[i].length * headSize * 1.35;
      lines[i].forEach((ln, li) => {
        text(c, c.bold, headSize, xs[i] + pad, c.y + (h - hh) / 2 + headSize * 1.05 + li * headSize * 1.35, ln, "FFFFFF", "center", widths[i] - 2 * pad);
      });
    });
    rect(c, MX, c.y + h - 1.4, avail, 1.4, PINK);
    c.y += h;
  };

  if (!firstOnPage && c.y + 90 > PH - BOTTOM) newPage(c);
  if (!firstOnPage) c.y += 6;
  heading();
  c.y += 4;
  header();

  const body = (row: CellValue[], zebra: boolean, total: boolean) => {
    const cells = cols.map((col, i) => {
      const t = fmtCell(row[i], col);
      const f = total ? c.bold : c.reg;
      return { t, lines: wrap(f, t, size, widths[i] - 2 * pad), f };
    });
    const h = Math.max(1, ...cells.map((x) => x.lines.length)) * lineH + 9;
    if (c.y + h > PH - BOTTOM) {
      newPage(c);
      header();
    }
    if (total) {
      rect(c, MX, c.y, avail, h, BRAND.total);
      hline(c, MX, PW - MX, c.y, BRAND.deep, 1.2);
    } else if (zebra) rect(c, MX, c.y, avail, h, BRAND.zebra);
    cells.forEach((cell, i) => {
      const col = cols[i];
      const align: Align = col.type === "number" ? "right" : col.type === "text" || col.type == null ? "left" : "center";
      const hh = cell.lines.length * lineH;
      cell.lines.forEach((ln, li) => {
        text(c, cell.f, size, xs[i] + pad, c.y + (h - hh) / 2 + size * 1.05 + li * lineH, ln, total ? BRAND.deep : BRAND.ink, align, widths[i] - 2 * pad);
      });
    });
    c.y += h;
    if (!total) hline(c, MX, PW - MX, c.y, BRAND.line, 0.5);
  };

  if (sheet.rows.length === 0) {
    const h = 34;
    rect(c, MX, c.y, avail, h, BRAND.zebra);
    text(c, c.reg, 9.5, MX, c.y + 21, "표시할 내용이 없습니다.", BRAND.muted, "center", avail);
    c.y += h;
  }
  sheet.rows.forEach((r, i) => body(r, i % 2 === 1, false));
  if (sheet.totals) body(sheet.totals, false, true);
  c.y += 14;
}

// ---------------------------------------------------------------------

export async function buildPdf(doc: ExportDoc, origin: string): Promise<Uint8Array> {
  const [regBuf, boldBuf, logoBuf] = await Promise.all([
    asset("Pretendard-Regular.otf", origin),
    asset("Pretendard-Bold.otf", origin),
    asset("logo.png", origin),
  ]);
  const pdf = new Pdf();
  const catalog = pdf.reserve();
  const pagesId = pdf.reserve();
  const regId = pdf.reserve();
  const boldId = pdf.reserve();
  const logo = pngImage(pdf, logoBuf);

  const c: Ctx = {
    pdf,
    reg: new FontRef(new OtfFont(regBuf, "Pretendard-Regular"), "/F1"),
    bold: new FontRef(new OtfFont(boldBuf, "Pretendard-Bold"), "/F2"),
    logo,
    pages: [],
    ops: [],
    y: 0,
    doc,
    generated: seoulStamp(),
  };

  newPage(c, true);
  cover(c);
  doc.sheets.forEach((s, i) => drawSheet(c, s, i === 0));

  c.pages.forEach((ops, i) => footer(c, i + 1, c.pages.length, ops));

  c.reg.write(pdf, regId);
  c.bold.write(pdf, boldId);

  const pageIds: number[] = [];
  for (const ops of c.pages) {
    const content = pdf.stream("/Filter /FlateDecode", deflateSync(Buffer.from(ops.join("\n"), "latin1")));
    pageIds.push(
      pdf.add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PW} ${PH}] /Contents ${content} 0 R ` +
          `/Resources << /Font << /F1 ${regId} 0 R /F2 ${boldId} 0 R >> /XObject << /Im1 ${logo.id} 0 R >> >> >>`,
      ),
    );
  }
  pdf.set(pagesId, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] >>`);
  pdf.set(catalog, `<< /Type /Catalog /Pages ${pagesId} 0 R /PageLayout /SinglePage >>`);
  const info = pdf.add(`<< /Title <${utf16hex(doc.title)}> /Author <${utf16hex(`BEAUTY WAVE in INCHEON 2026 ${OPS_TEAM}`)}> /Producer (BEAUTY WAVE) >>`);
  return pdf.build(catalog, info);
}
