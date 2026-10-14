import { discountRate, giftTotal, submissionGiftSummary } from "@/lib/calc";
import type { AdminCompany } from "@/lib/types";
import { buildXlsx, colLetter, type SheetSpec } from "./xlsx";

export type ExportType = "all" | "price-board" | "lucky-draw" | "links";

export const EXPORT_FILES: Record<ExportType, string> = {
  all: "전체_참가업체_제출정보",
  "price-board": "부스별_가격안내판_제작용",
  "lucky-draw": "럭키드로우_경품관리",
  links: "업체별_제출링크",
};

const d = (iso: string | null | undefined) => (iso ? new Date(iso) : null);
const rate = (r: number, e: number) => {
  const v = discountRate(r, e);
  return v == null ? null : v / 100;
};
const sum = (col: number, rows: number, value: number) =>
  rows > 0 ? { formula: `SUM(${colLetter(col)}2:${colLetter(col)}${rows + 1})`, value } : value;

function allSheets(companies: AdminCompany[]): SheetSpec[] {
  const status: SheetSpec = {
    name: "업체별 제출 현황",
    columns: [
      { header: "순번", width: 6, type: "number" },
      { header: "등록 업체명", width: 24 },
      { header: "제출 업체명", width: 24 },
      { header: "제출 여부", width: 10 },
      { header: "대표 판매상품 수", width: 10, type: "number" },
      { header: "럭키드로우 제공 여부", width: 12 },
      { header: "경품 종류 수", width: 10, type: "number" },
      { header: "경품 총수량", width: 11, type: "number" },
      { header: "경품 총금액(정상가 기준, 원)", width: 16, type: "number" },
      { header: "최초 제출일", width: 17, type: "datetime" },
      { header: "최종 수정일", width: 17, type: "datetime" },
      { header: "최종 수정자", width: 10 },
      { header: "수정 잠금", width: 9 },
    ],
    rows: companies.map((c, i) => {
      const s = c.submission;
      const g = submissionGiftSummary(s);
      return [
        i + 1,
        c.name,
        s?.companyName ?? "",
        s ? "제출 완료" : "미제출",
        s ? s.products.length : null,
        s ? (s.luckyDrawProvided ? "제공함" : "제공하지 않음") : "",
        s ? g.kinds : null,
        s ? g.quantity : null,
        s ? g.amount : null,
        d(s?.firstSubmittedAt),
        d(s?.updatedAt),
        s ? (s.updatedBy === "admin" ? "운영사무국" : "참가업체") : "",
        c.isLocked ? "잠금" : "",
      ];
    }),
  };

  const productRows: SheetSpec["rows"] = [];
  const giftRows: SheetSpec["rows"] = [];
  companies.forEach((c, i) => {
    const s = c.submission;
    if (!s) return;
    s.products.forEach((p, pi) => {
      productRows.push([
        i + 1,
        s.companyName,
        pi + 1,
        p.name,
        p.regularPrice,
        p.eventPrice,
        rate(p.regularPrice, p.eventPrice),
        p.sampleProvided ? "제공함" : "제공하지 않음",
        p.extraBenefit,
      ]);
    });
    if (s.luckyDrawProvided) {
      s.gifts.forEach((g, gi) => {
        const rn = giftRows.length + 2;
        giftRows.push([i + 1, s.companyName, gi + 1, g.name, g.quantity, g.unitPrice, { formula: `E${rn}*F${rn}`, value: giftTotal(g) }]);
      });
    }
  });

  const products: SheetSpec = {
    name: "대표 판매상품",
    columns: [
      { header: "업체 순번", width: 8, type: "number" },
      { header: "업체명", width: 24 },
      { header: "상품 번호", width: 8, type: "number" },
      { header: "대표 판매상품명", width: 30 },
      { header: "정상 판매가(원)", width: 13, type: "number" },
      { header: "행사 특별 할인가(원)", width: 13, type: "number" },
      { header: "할인율", width: 8, type: "percent" },
      { header: "샘플 제공 여부", width: 12 },
      { header: "추가 이벤트 혜택", width: 36 },
    ],
    rows: productRows,
  };

  const totalQty = giftRows.reduce((a, r) => a + (r[4] as number), 0);
  const totalAmt = giftRows.reduce((a, r) => a + (r[6] as { value: number }).value, 0);
  const gifts: SheetSpec = {
    name: "럭키드로우 경품",
    columns: [
      { header: "업체 순번", width: 8, type: "number" },
      { header: "업체명", width: 24 },
      { header: "경품 번호", width: 8, type: "number" },
      { header: "제공 상품명", width: 30 },
      { header: "제공 수량(개)", width: 11, type: "number" },
      { header: "정상 판매가(1개, 원)", width: 14, type: "number" },
      { header: "총금액(원)", width: 15, type: "number" },
    ],
    rows: giftRows,
    totals: ["", "합계", "", "", sum(4, giftRows.length, totalQty), "", sum(6, giftRows.length, totalAmt)],
  };
  return [status, products, gifts];
}

function priceBoardSheets(companies: AdminCompany[]): SheetSpec[] {
  const rows: SheetSpec["rows"] = [];
  companies.forEach((c, i) => {
    const s = c.submission;
    if (!s) return;
    s.products.forEach((p, pi) => {
      rows.push([
        i + 1,
        s.companyName,
        pi + 1,
        p.name,
        p.regularPrice,
        p.eventPrice,
        p.regularPrice - p.eventPrice,
        rate(p.regularPrice, p.eventPrice),
        p.sampleProvided ? "샘플 제공" : "",
        p.extraBenefit === "없음" ? "" : p.extraBenefit,
      ]);
    });
  });
  return [
    {
      name: "가격 안내판",
      columns: [
        { header: "업체 순번", width: 8, type: "number" },
        { header: "업체명", width: 24 },
        { header: "상품 번호", width: 8, type: "number" },
        { header: "상품명", width: 30 },
        { header: "정상 판매가(원)", width: 13, type: "number" },
        { header: "행사 특별 할인가(원)", width: 13, type: "number" },
        { header: "할인 금액(원)", width: 12, type: "number" },
        { header: "할인율", width: 8, type: "percent" },
        { header: "샘플", width: 10 },
        { header: "추가 이벤트 혜택", width: 36 },
      ],
      rows,
    },
  ];
}

function luckyDrawSheets(companies: AdminCompany[]): SheetSpec[] {
  const items: SheetSpec["rows"] = [];
  const byCompany: SheetSpec["rows"] = [];
  companies.forEach((c) => {
    const s = c.submission;
    if (!s || !s.luckyDrawProvided) return;
    s.gifts.forEach((g) => {
      const rn = items.length + 2;
      items.push([s.companyName, g.name, g.quantity, g.unitPrice, { formula: `C${rn}*D${rn}`, value: giftTotal(g) }]);
    });
    const sm = submissionGiftSummary(s);
    byCompany.push([s.companyName, sm.kinds, sm.quantity, sm.amount]);
  });
  const qty = items.reduce((a, r) => a + (r[2] as number), 0);
  const amt = items.reduce((a, r) => a + (r[4] as { value: number }).value, 0);
  return [
    {
      name: "경품 목록",
      columns: [
        { header: "제공 업체명", width: 24 },
        { header: "경품 상품명", width: 30 },
        { header: "제공 수량(개)", width: 11, type: "number" },
        { header: "정상 판매가(1개, 원)", width: 14, type: "number" },
        { header: "총금액(원)", width: 15, type: "number" },
      ],
      rows: items,
      totals: ["전체 합계", `${items.length}종`, sum(2, items.length, qty), "", sum(4, items.length, amt)],
    },
    {
      name: "업체별 합계",
      columns: [
        { header: "제공 업체명", width: 24 },
        { header: "경품 종류 수", width: 11, type: "number" },
        { header: "총수량(개)", width: 11, type: "number" },
        { header: "총금액(정상가 기준, 원)", width: 16, type: "number" },
      ],
      rows: byCompany,
      totals: ["전체 합계", sum(1, byCompany.length, items.length), sum(2, byCompany.length, qty), sum(3, byCompany.length, amt)],
    },
  ];
}

function linkSheets(companies: AdminCompany[], baseUrl: string): SheetSpec[] {
  return [
    {
      name: "업체별 제출 링크",
      columns: [
        { header: "순번", width: 6, type: "number" },
        { header: "업체명", width: 24 },
        { header: "전용 제출 링크", width: 70 },
        { header: "제출 여부", width: 10 },
      ],
      rows: companies.map((c, i) => [i + 1, c.name, `${baseUrl}/s/${c.token}`, c.submission ? "제출 완료" : "미제출"]),
    },
  ];
}

export async function buildExport(type: ExportType, companies: AdminCompany[], baseUrl: string) {
  const sheets =
    type === "all"
      ? allSheets(companies)
      : type === "price-board"
        ? priceBoardSheets(companies)
        : type === "lucky-draw"
          ? luckyDrawSheets(companies)
          : linkSheets(companies, baseUrl);
  return buildXlsx(sheets);
}

export async function buildImportTemplate() {
  return buildXlsx([
    {
      name: "업체 명단",
      columns: [{ header: "업체명", width: 30 }],
      // '○○' 가 들어간 예시 행과 '업체명' 제목 행은 등록 시 자동으로 건너뜁니다.
      rows: [["주식회사 ○○뷰티"]],
    },
  ]);
}
