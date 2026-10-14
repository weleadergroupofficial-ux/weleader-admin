import JSZip from "jszip";

/**
 * 가벼운 XLSX 작성기/판독기.
 * - 금액·수량은 숫자 셀로 저장하고 '#,##0' 서식으로 천 단위 쉼표를 표시합니다(계산 가능).
 * - 문자열은 inline string 으로만 기록하므로 '=' 로 시작하는 입력도 수식으로 실행되지 않습니다.
 */

export type ColType = "text" | "number" | "percent" | "datetime";
export interface Column {
  header: string;
  width?: number;
  type?: ColType;
}
export type CellValue = string | number | Date | null | undefined | { formula: string; value: number };
export interface SheetSpec {
  name: string;
  columns: Column[];
  rows: CellValue[][];
  totals?: CellValue[];
}

const STYLE = { header: 1, text: 2, number: 3, percent: 4, datetime: 5, totalText: 6, totalNumber: 7 } as const;

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

function cellXml(ref: string, v: CellValue, type: ColType, isTotal: boolean): string {
  if (v == null || v === "") {
    const s = isTotal ? STYLE.totalText : type === "text" ? STYLE.text : STYLE[type];
    return `<c r="${ref}" s="${s}"/>`;
  }
  if (typeof v === "object" && !(v instanceof Date)) {
    const s = isTotal ? STYLE.totalNumber : type === "percent" ? STYLE.percent : STYLE.number;
    return `<c r="${ref}" s="${s}"><f>${esc(v.formula)}</f><v>${v.value}</v></c>`;
  }
  if (v instanceof Date) {
    return `<c r="${ref}" s="${STYLE.datetime}"><v>${excelSerial(v)}</v></c>`;
  }
  if (typeof v === "number") {
    const s = isTotal ? STYLE.totalNumber : type === "percent" ? STYLE.percent : type === "datetime" ? STYLE.datetime : STYLE.number;
    return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  }
  const s = isTotal ? STYLE.totalText : STYLE.text;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function sheetXml(spec: SheetSpec): string {
  const cols = spec.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 14}" customWidth="1"/>`)
    .join("");
  const rows: string[] = [];
  rows.push(
    `<row r="1" ht="30" customHeight="1">${spec.columns
      .map((c, i) => `<c r="${colLetter(i)}1" s="${STYLE.header}" t="inlineStr"><is><t>${esc(c.header)}</t></is></c>`)
      .join("")}</row>`,
  );
  spec.rows.forEach((r, ri) => {
    const rn = ri + 2;
    rows.push(
      `<row r="${rn}">${spec.columns.map((c, ci) => cellXml(`${colLetter(ci)}${rn}`, r[ci], c.type ?? "text", false)).join("")}</row>`,
    );
  });
  if (spec.totals) {
    const rn = spec.rows.length + 2;
    rows.push(
      `<row r="${rn}" ht="24" customHeight="1">${spec.columns
        .map((c, ci) => cellXml(`${colLetter(ci)}${rn}`, spec.totals![ci], c.type ?? "text", true))
        .join("")}</row>`,
    );
  }
  const last = colLetter(spec.columns.length - 1);
  const filter = `<autoFilter ref="A1:${last}${Math.max(spec.rows.length + 1, 1)}"/>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="18"/>` +
    `<cols>${cols}</cols><sheetData>${rows.join("")}</sheetData>${filter}` +
    `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>` +
    `</worksheet>`
  );
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts>` +
  `<fonts count="3">` +
  `<font><sz val="10"/><name val="맑은 고딕"/><family val="2"/></font>` +
  `<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/><family val="2"/></font>` +
  `<font><b/><sz val="10"/><color rgb="FF2A1F45"/><name val="맑은 고딕"/><family val="2"/></font>` +
  `</fonts>` +
  `<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF6B4FD8"/><bgColor indexed="64"/></patternFill></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFEFE9FB"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
  `<border><left style="thin"><color rgb="FFD9D2EA"/></left><right style="thin"><color rgb="FFD9D2EA"/></right>` +
  `<top style="thin"><color rgb="FFD9D2EA"/></top><bottom style="thin"><color rgb="FFD9D2EA"/></bottom><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="8">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>` +
  `<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
  `<xf numFmtId="9" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
  `<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
  `<xf numFmtId="3" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

function safeSheetName(name: string, used: Set<string>): string {
  let n = name.replace(/[\[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet";
  let i = 2;
  while (used.has(n)) n = `${name.slice(0, 28)} ${i++}`;
  used.add(n);
  return n;
}

export async function buildXlsx(sheets: SheetSpec[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const used = new Set<string>();
  const names = sheets.map((s) => safeSheetName(s.name, used));

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
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
      `<definedNames>${sheets
        .map(
          (s, i) =>
            `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i].replace(/'/g, "''"))}'!$A$1:$${colLetter(
              s.columns.length - 1,
            )}$${Math.max(s.rows.length + 1, 1)}</definedName>`,
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
  zip.file("xl/styles.xml", STYLES_XML);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
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
