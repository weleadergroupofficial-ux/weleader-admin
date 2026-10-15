import JSZip from "jszip";

/**
 * 가벼운 XLSX 작성기/판독기.
 * - 금액·수량은 숫자 셀로 저장하고 '#,##0' 서식으로 천 단위 쉼표를 표시합니다(계산 가능).
 * - 문자열은 inline string 으로만 기록하므로 '=' 로 시작하는 입력도 수식으로 실행되지 않습니다.
 * - 제목 영역 · 머리글 · 줄무늬 · 합계 행 · 인쇄 설정(가로, 머리글 반복, 쪽 번호)을 행사 톤에 맞춰 꾸밉니다.
 */

export type ColType = "text" | "center" | "number" | "percent" | "datetime";
export interface Column {
  header: string;
  width?: number;
  type?: ColType;
}
export type CellValue = string | number | Date | null | undefined | { formula: string; value: number };
export interface SheetSpec {
  name: string;
  /** PDF 에서 표 위에 보이는 소제목 (없으면 시트 이름) */
  heading?: string;
  columns: Column[];
  rows: CellValue[][];
  totals?: CellValue[];
}
/** 엑셀·PDF 공통 문서 정의 */
export interface ExportDoc {
  title: string;
  subtitle?: string;
  kpis?: Array<[string, string]>;
  sheets: SheetSpec[];
  /** true 면 제목 영역 없이 1행이 머리글인 단순 표 (업로드용 양식) */
  plain?: boolean;
}

/** 머리글 행 번호(1부터)와 첫 데이터 행 번호 */
export const HEADER_ROW = 4;
export const FIRST_ROW = HEADER_ROW + 1;

export const BRAND = {
  deep: "571173", // 로고 보라
  violet: "6A4BD6",
  ink: "2A1F45",
  muted: "6C6484",
  zebra: "F6F0FA",
  total: "EADCF5",
  line: "DCCDEB",
};

function esc(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function colLetter(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 엑셀 날짜 일련번호(한국 시간 기준) */
function excelSerial(d: Date): number {
  return (d.getTime() + 9 * 3600 * 1000) / 86400000 + 25569;
}

// ---------------------------------------------------------------------
// 스타일 등록기
// ---------------------------------------------------------------------

interface XfSpec {
  numFmt?: number;
  font: number;
  fill?: number;
  border?: number;
  h?: "left" | "center" | "right";
  wrap?: boolean;
}

class Styles {
  private list: XfSpec[] = [{ font: 0 }];
  private index = new Map<string, number>([[JSON.stringify({ font: 0 }), 0]]);
  xf(s: XfSpec): number {
    const key = JSON.stringify(s);
    const hit = this.index.get(key);
    if (hit != null) return hit;
    this.list.push(s);
    this.index.set(key, this.list.length - 1);
    return this.list.length - 1;
  }
  xml(): string {
    const fonts = [
      `<font><sz val="10"/><color rgb="FF${BRAND.ink}"/><name val="맑은 고딕"/><family val="2"/></font>`,
      `<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/><family val="2"/></font>`,
      `<font><b/><sz val="10"/><color rgb="FF${BRAND.deep}"/><name val="맑은 고딕"/><family val="2"/></font>`,
      `<font><b/><sz val="20"/><color rgb="FF${BRAND.deep}"/><name val="맑은 고딕"/><family val="2"/></font>`,
      `<font><sz val="10"/><color rgb="FF${BRAND.muted}"/><name val="맑은 고딕"/><family val="2"/></font>`,
      `<font><b/><sz val="10"/><color rgb="FF${BRAND.violet}"/><name val="맑은 고딕"/><family val="2"/></font>`,
    ];
    const fills = [
      `<fill><patternFill patternType="none"/></fill>`,
      `<fill><patternFill patternType="gray125"/></fill>`,
      `<fill><patternFill patternType="solid"><fgColor rgb="FF${BRAND.deep}"/><bgColor indexed="64"/></patternFill></fill>`,
      `<fill><patternFill patternType="solid"><fgColor rgb="FF${BRAND.zebra}"/><bgColor indexed="64"/></patternFill></fill>`,
      `<fill><patternFill patternType="solid"><fgColor rgb="FF${BRAND.total}"/><bgColor indexed="64"/></patternFill></fill>`,
    ];
    const line = (side: string, style: string, color: string) => `<${side} style="${style}"><color rgb="FF${color}"/></${side}>`;
    const borders = [
      `<border><left/><right/><top/><bottom/><diagonal/></border>`,
      // 1: 데이터 행 — 아래쪽 가는 선만
      `<border><left/><right/><top/>${line("bottom", "thin", BRAND.line)}<diagonal/></border>`,
      // 2: 머리글 — 아래쪽 굵은 선
      `<border><left/><right/><top/>${line("bottom", "medium", BRAND.violet)}<diagonal/></border>`,
      // 3: 합계 — 위쪽 굵은 선
      `<border><left/><right/>${line("top", "medium", BRAND.deep)}${line("bottom", "thin", BRAND.deep)}<diagonal/></border>`,
    ];
    const xfs = this.list.map((s) => {
      const attrs = [
        `numFmtId="${s.numFmt ?? 0}"`,
        `fontId="${s.font}"`,
        `fillId="${s.fill ?? 0}"`,
        `borderId="${s.border ?? 0}"`,
        `xfId="0"`,
        s.numFmt ? `applyNumberFormat="1"` : "",
        `applyFont="1"`,
        s.fill ? `applyFill="1"` : "",
        s.border ? `applyBorder="1"` : "",
        `applyAlignment="1"`,
      ]
        .filter(Boolean)
        .join(" ");
      return `<xf ${attrs}><alignment horizontal="${s.h ?? "left"}" vertical="center"${s.wrap ? ` wrapText="1"` : ""}/></xf>`;
    });
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts>` +
      `<fonts count="${fonts.length}">${fonts.join("")}</fonts>` +
      `<fills count="${fills.length}">${fills.join("")}</fills>` +
      `<borders count="${borders.length}">${borders.join("")}</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`
    );
  }
}

const FONT = { body: 0, head: 1, total: 2, title: 3, sub: 4, kpi: 5 };
const FILL = { none: 0, head: 2, zebra: 3, total: 4 };
const BORDER = { none: 0, row: 1, head: 2, total: 3 };

function bodyXf(st: Styles, type: ColType, zebra: boolean): number {
  const fill = zebra ? FILL.zebra : FILL.none;
  if (type === "number") return st.xf({ numFmt: 3, font: FONT.body, fill, border: BORDER.row, h: "right" });
  if (type === "percent") return st.xf({ numFmt: 9, font: FONT.body, fill, border: BORDER.row, h: "center" });
  if (type === "datetime") return st.xf({ numFmt: 164, font: FONT.body, fill, border: BORDER.row, h: "center" });
  if (type === "center") return st.xf({ font: FONT.body, fill, border: BORDER.row, h: "center", wrap: true });
  return st.xf({ font: FONT.body, fill, border: BORDER.row, h: "left", wrap: true });
}

function totalXf(st: Styles, type: ColType): number {
  if (type === "number") return st.xf({ numFmt: 3, font: FONT.total, fill: FILL.total, border: BORDER.total, h: "right" });
  if (type === "percent") return st.xf({ numFmt: 9, font: FONT.total, fill: FILL.total, border: BORDER.total, h: "center" });
  return st.xf({ font: FONT.total, fill: FILL.total, border: BORDER.total, h: type === "center" ? "center" : "left" });
}

function cellXml(st: Styles, ref: string, v: CellValue, type: ColType, zebra: boolean, isTotal: boolean): string {
  const s = isTotal ? totalXf(st, type) : bodyXf(st, type, zebra);
  if (v == null || v === "") return `<c r="${ref}" s="${s}"/>`;
  if (typeof v === "object" && !(v instanceof Date)) {
    return `<c r="${ref}" s="${s}"><f>${esc(v.formula)}</f><v>${v.value}</v></c>`;
  }
  if (v instanceof Date) return `<c r="${ref}" s="${bodyXf(st, "datetime", zebra)}"><v>${excelSerial(v)}</v></c>`;
  if (typeof v === "number") return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function sheetXml(st: Styles, doc: ExportDoc, spec: SheetSpec, generated: string): string {
  const n = spec.columns.length;
  const last = colLetter(n - 1);
  const HR = doc.plain ? 1 : HEADER_ROW;
  const FR = HR + 1;
  const cols = spec.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 14}" customWidth="1"/>`).join("");

  const titleXf = st.xf({ font: FONT.title, h: "left" });
  const subXf = st.xf({ font: FONT.sub, h: "left" });
  const kpiXf = st.xf({ font: FONT.kpi, h: "left" });
  const headXf = st.xf({ font: FONT.head, fill: FILL.head, border: BORDER.head, h: "center", wrap: true });

  const subtitle = [doc.subtitle, `생성 ${generated}`].filter(Boolean).join("   ·   ");
  const kpi = (doc.kpis ?? []).map(([k, v]) => `${k} ${v}`).join("     |     ");

  const rows: string[] = [];
  const textRow = (r: number, ht: number, text: string, xf: number) =>
    `<row r="${r}" ht="${ht}" customHeight="1"><c r="A${r}" s="${xf}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c></row>`;
  if (!doc.plain) {
    rows.push(textRow(1, 38, doc.title, titleXf));
    rows.push(textRow(2, 20, subtitle, subXf));
    rows.push(textRow(3, 22, kpi, kpiXf));
  }
  rows.push(
    `<row r="${HR}" ht="32" customHeight="1">${spec.columns
      .map((c, i) => `<c r="${colLetter(i)}${HR}" s="${headXf}" t="inlineStr"><is><t>${esc(c.header)}</t></is></c>`)
      .join("")}</row>`,
  );
  spec.rows.forEach((r, ri) => {
    const rn = FR + ri;
    const zebra = ri % 2 === 1;
    rows.push(
      `<row r="${rn}" ht="22" customHeight="1">${spec.columns
        .map((c, ci) => cellXml(st, `${colLetter(ci)}${rn}`, r[ci], c.type ?? "text", zebra, false))
        .join("")}</row>`,
    );
  });
  if (spec.totals) {
    const rn = FR + spec.rows.length;
    rows.push(
      `<row r="${rn}" ht="26" customHeight="1">${spec.columns
        .map((c, ci) => cellXml(st, `${colLetter(ci)}${rn}`, spec.totals![ci], c.type ?? "text", false, true))
        .join("")}</row>`,
    );
  }

  const lastDataRow = Math.max(FR + spec.rows.length - 1, HR);
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetPr><tabColor rgb="FF${BRAND.deep}"/><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="${HR}" topLeftCell="A${FR}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="20"/>` +
    `<cols>${cols}</cols><sheetData>${rows.join("")}</sheetData>` +
    `<autoFilter ref="A${HR}:${last}${lastDataRow}"/>` +
    (doc.plain ? "" : `<mergeCells count="3"><mergeCell ref="A1:${last}1"/><mergeCell ref="A2:${last}2"/><mergeCell ref="A3:${last}3"/></mergeCells>`) +
    `<printOptions horizontalCentered="1"/>` +
    `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.7" header="0.3" footer="0.3"/>` +
    `<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>` +
    `<headerFooter><oddFooter>&amp;L&amp;8BEAUTY WAVE in INCHEON 2026 · 운영사무국&amp;R&amp;8&amp;P / &amp;N</oddFooter></headerFooter>` +
    `</worksheet>`
  );
}

function safeSheetName(name: string, used: Set<string>): string {
  let n = name.replace(/[\[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet";
  let i = 2;
  while (used.has(n)) n = `${name.slice(0, 28)} ${i++}`;
  used.add(n);
  return n;
}

function seoulStamp(d = new Date()): string {
  const p = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}.${g("month")}.${g("day")} ${g("hour")}:${g("minute")}`;
}
export { seoulStamp };

export async function buildXlsx(doc: ExportDoc): Promise<Uint8Array> {
  const sheets = doc.sheets;
  const zip = new JSZip();
  const used = new Set<string>();
  const names = sheets.map((s) => safeSheetName(s.name, used));
  const st = new Styles();
  const generated = seoulStamp();
  const sheetXmls = sheets.map((s) => sheetXml(st, doc, s, generated));

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("") +
      `</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  );
  const hr = doc.plain ? 1 : HEADER_ROW;
  const qn = (i: number) => `'${esc(names[i].replace(/'/g, "''"))}'`;
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
      `<definedNames>${sheets
        .map(
          (s, i) =>
            `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${qn(i)}!$A$${hr}:$${colLetter(
              s.columns.length - 1,
            )}$${Math.max(hr + s.rows.length, hr)}</definedName>` +
            `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${qn(i)}!$${hr}:$${hr}</definedName>`,
        )
        .join("")}</definedNames>` +
      `</workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
  );
  zip.file("xl/styles.xml", st.xml());
  sheetXmls.forEach((x, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, x));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

// ---------------------------------------------------------------------
// 판독: 첫 번째 시트의 A열 값 목록 (업체 일괄 등록용)
// ---------------------------------------------------------------------

function unesc(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

function textOf(xml: string): string {
  const out: string[] = [];
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(unesc(m[1]));
  return out.join("");
}

export async function readFirstColumn(data: ArrayBuffer | Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(data);
  const wb = await zip.file("xl/workbook.xml")?.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!wb || !rels) throw new Error("엑셀(.xlsx) 파일 형식이 아닙니다.");
  const firstRid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1];
  let target = "worksheets/sheet1.xml";
  if (firstRid) {
    const relRe = /<Relationship\b[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = relRe.exec(rels))) {
      if (m[0].includes(`Id="${firstRid}"`)) {
        target = /Target="([^"]+)"/.exec(m[0])?.[1] ?? target;
      }
    }
  }
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const sheet = await zip.file(path)?.async("string");
  if (!sheet) throw new Error("첫 번째 시트를 읽을 수 없습니다.");

  const shared: string[] = [];
  const sst = await zip.file("xl/sharedStrings.xml")?.async("string");
  if (sst) {
    const siRe = /<si>([\s\S]*?)<\/si>/g;
    let m: RegExpExecArray | null;
    while ((m = siRe.exec(sst))) shared.push(textOf(m[1]));
  }

  const values: string[] = [];
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(sheet))) {
    const attrs = m[1];
    const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
    if (ref !== "A") continue;
    const inner = m[2] ?? "";
    const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
    let v = "";
    if (t === "s") v = shared[Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? -1)] ?? "";
    else if (t === "inlineStr") v = textOf(inner);
    else v = unesc(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
    values.push(v.trim());
  }
  return values;
}

/** CSV 첫 번째 열 */
export function readCsvFirstColumn(text: string): string[] {
  return text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (t.startsWith('"')) {
        const end = t.indexOf('"', 1);
        return (end > 0 ? t.slice(1, end) : t.slice(1)).trim();
      }
      return t.split(",")[0].trim();
    });
}
