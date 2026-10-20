import { discountRate, giftTotal, submissionGiftSummary } from "@/lib/calc";
import type { AdminCompany } from "@/lib/types";
import { EVENT_DAYS, type SalesEntry } from "@/lib/event";
import { computeSalesStats } from "@/lib/salesStats";
import { colLetter, FIRST_ROW, type ExportDoc, type SheetSpec } from "./xlsx";

export type ExportType = "all" | "price-board" | "lucky-draw" | "links" | "sales" | "sales-report";

export const EXPORT_FILES: Record<ExportType, string> = {
  all: "전체_참가업체_제출정보",
  "price-board": "부스별_가격안내판_제작용",
  "lucky-draw": "럭키드로우_경품관리",
  links: "업체별_제출링크",
  sales: "일자별_판매실적",
  "sales-report": "판매실적_성과리포트",
};

const TITLES: Record<ExportType, [string, string]> = {
  all: ["전체 참가업체 제출 정보", "업체별 제출 현황 · 대표 판매상품 · 럭키드로우 경품"],
  "price-board": ["부스별 가격 안내판 제작용 데이터", "상품명 · 정상가 · 행사 할인가 · 할인율"],
  "lucky-draw": ["럭키드로우 경품 관리", "경품 목록 및 업체별 합계"],
  links: ["업체별 제출 링크", "참가업체 전용 제출 링크 및 제출 여부"],
  sales: ["일자별 판매실적", "행사 기간 10/23 · 10/24 · 10/25 업체별 판매실적"],
  "sales-report": ["판매실적 성과 리포트", "2026.10.23 (금) – 10.25 (일) · 주최 인천광역시 · 주관 인천테크노파크 · 운영 주식회사 웰리더"],
};

const NOT_ENTERED = "미입력";
const d = (iso: string | null | undefined) => (iso ? new Date(iso) : null);
const rate = (r: number, e: number) => {
  const v = discountRate(r, e);
  return v == null ? null : v / 100;
};
const sum = (col: number, rows: number, value: number) =>
  rows > 0 ? { formula: `SUM(${colLetter(col)}${FIRST_ROW}:${colLetter(col)}${FIRST_ROW + rows - 1})`, value } : value;

function allSheets(companies: AdminCompany[]): SheetSpec[] {
  const status: SheetSpec = {
    name: "업체별 제출 현황",
    columns: [
      { header: "순번", width: 6, type: "center" },
      { header: "등록 업체명", width: 24 },
      { header: "제출 업체명", width: 24 },
      { header: "제출 여부", width: 10, type: "center" },
      { header: "대표 판매상품 수", width: 10, type: "number" },
      { header: "럭키드로우 제공 여부", width: 12, type: "center" },
      { header: "경품 종류 수", width: 10, type: "number" },
      { header: "경품 총수량", width: 11, type: "number" },
      { header: "경품 총금액(정상가 기준, 원)", width: 16, type: "number" },
      { header: "최초 제출일", width: 17, type: "datetime" },
      { header: "최종 수정일", width: 17, type: "datetime" },
      { header: "최종 수정자", width: 10, type: "center" },
      { header: "수정 잠금", width: 9, type: "center" },
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
        const rn = giftRows.length + FIRST_ROW;
        giftRows.push([i + 1, s.companyName, gi + 1, g.name, g.quantity, g.unitPrice, { formula: `E${rn}*F${rn}`, value: giftTotal(g) }]);
      });
    }
  });

  const products: SheetSpec = {
    name: "대표 판매상품",
    columns: [
      { header: "업체 순번", width: 8, type: "center" },
      { header: "업체명", width: 24 },
      { header: "상품 번호", width: 8, type: "number" },
      { header: "대표 판매상품명", width: 30 },
      { header: "정상 판매가(원)", width: 13, type: "number" },
      { header: "행사 특별 할인가(원)", width: 13, type: "number" },
      { header: "할인율", width: 8, type: "percent" },
      { header: "샘플 제공 여부", width: 12, type: "center" },
      { header: "추가 이벤트 혜택", width: 36 },
    ],
    rows: productRows,
  };

  const totalQty = giftRows.reduce((a, r) => a + (r[4] as number), 0);
  const totalAmt = giftRows.reduce((a, r) => a + (r[6] as { value: number }).value, 0);
  const gifts: SheetSpec = {
    name: "럭키드로우 경품",
    columns: [
      { header: "업체 순번", width: 8, type: "center" },
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
        { header: "업체 순번", width: 8, type: "center" },
        { header: "업체명", width: 24 },
        { header: "상품 번호", width: 8, type: "number" },
        { header: "상품명", width: 30 },
        { header: "정상 판매가(원)", width: 13, type: "number" },
        { header: "행사 특별 할인가(원)", width: 13, type: "number" },
        { header: "할인 금액(원)", width: 12, type: "number" },
        { header: "할인율", width: 8, type: "percent" },
        { header: "샘플", width: 10, type: "center" },
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
      const rn = items.length + FIRST_ROW;
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
        { header: "순번", width: 6, type: "center" },
        { header: "업체명", width: 24 },
        { header: "전용 제출 링크", width: 70 },
        { header: "제출 여부", width: 10, type: "center" },
      ],
      rows: companies.map((c, i) => [i + 1, c.name, `${baseUrl}/s/${c.token}`, c.submission ? "제출 완료" : "미제출"]),
    },
  ];
}

function salesSheets(companies: AdminCompany[], sales: SalesEntry[]): SheetSpec[] {
  const by = new Map<string, SalesEntry>();
  for (const e of sales) if (e.companyId) by.set(`${e.companyId}|${e.day}`, e);

  const rows: SheetSpec["rows"] = [];
  const totals = { visitors: EVENT_DAYS.map(() => 0), items: EVENT_DAYS.map(() => 0), amount: EVENT_DAYS.map(() => 0) };
  companies.forEach((c, i) => {
    const row: SheetSpec["rows"][number] = [i + 1, c.name];
    let tv = 0;
    let ti = 0;
    let ta = 0;
    EVENT_DAYS.forEach((d, di) => {
      const e = by.get(`${c.id}|${d.date}`);
      row.push(e ? (e.visitors ?? NOT_ENTERED) : NOT_ENTERED, e ? e.items : NOT_ENTERED, e ? e.amount : NOT_ENTERED);
      if (e) {
        totals.visitors[di] += e.visitors ?? 0;
        totals.items[di] += e.items;
        totals.amount[di] += e.amount;
        tv += e.visitors ?? 0;
        ti += e.items;
        ta += e.amount;
      }
    });
    const last = by.get(`${c.id}|${EVENT_DAYS[EVENT_DAYS.length - 1].date}`);
    const entered = EVENT_DAYS.filter((d) => by.has(`${c.id}|${d.date}`)).length;
    row.push(entered ? tv : NOT_ENTERED, entered ? ti : NOT_ENTERED, entered ? ta : NOT_ENTERED, `${entered}/${EVENT_DAYS.length}일`, last ? (last.surveyDone ? "완료" : "미완료") : "");
    rows.push(row);
  });

  const columns: SheetSpec["columns"] = [{ header: "순번", width: 6, type: "center" }, { header: "업체명", width: 26 }];
  for (const d of EVENT_DAYS) {
    columns.push(
      { header: `${d.short} 방문객(명)`, width: 11, type: "number" },
      { header: `${d.short} 판매 건수`, width: 11, type: "number" },
      { header: `${d.short} 판매금액(원)`, width: 16, type: "number" },
    );
  }
  columns.push(
    { header: "총 방문객(명)", width: 12, type: "number" },
    { header: "총 판매 건수", width: 12, type: "number" },
    { header: "총 판매금액(원)", width: 17, type: "number" },
    { header: "입력 일수", width: 10, type: "center" },
    { header: "10/25 만족도조사", width: 13, type: "center" },
  );
  const sumRow: SheetSpec["rows"][number] = ["", "전체 합계"];
  let gv = 0;
  let gi = 0;
  let ga = 0;
  EVENT_DAYS.forEach((_, di) => {
    sumRow.push(sum(2 + di * 3, rows.length, totals.visitors[di]), sum(3 + di * 3, rows.length, totals.items[di]), sum(4 + di * 3, rows.length, totals.amount[di]));
    gv += totals.visitors[di];
    gi += totals.items[di];
    ga += totals.amount[di];
  });
  const base = 2 + EVENT_DAYS.length * 3;
  sumRow.push(sum(base, rows.length, gv), sum(base + 1, rows.length, gi), sum(base + 2, rows.length, ga), "", "");

  const detail: SheetSpec["rows"] = [];
  const nameOf = new Map(companies.map((c) => [c.id, c.name]));
  const order = new Map(companies.map((c, i) => [c.id, i]));
  [...sales]
    .filter((e) => e.companyId && nameOf.has(e.companyId))
    .sort((a, b) => a.day.localeCompare(b.day) || (order.get(a.companyId!) ?? 0) - (order.get(b.companyId!) ?? 0))
    .forEach((e) => {
      const day = EVENT_DAYS.find((d) => d.date === e.day);
      detail.push([
        day ? `${day.label} (${day.weekday})` : e.day,
        nameOf.get(e.companyId!) ?? "",
        e.visitors ?? NOT_ENTERED,
        e.items,
        e.amount,
        day?.last ? (e.surveyDone ? "완료" : "미완료") : "",
        d(e.firstSubmittedAt),
        d(e.updatedAt),
        e.revision > 1 ? `${e.revision - 1}회 수정` : "",
      ]);
    });

  return [
    {
      name: "일자별 판매실적",
      heading: "업체별 · 일자별 판매실적",
      columns,
      rows,
      totals: ["", ...sumRow.slice(1)],
    },
    {
      name: "입력 내역",
      heading: "입력 내역 (일자순)",
      columns: [
        { header: "행사 일자", width: 16, type: "center" },
        { header: "업체명", width: 26 },
        { header: "방문객(명)", width: 11, type: "number" },
        { header: "판매 건수", width: 11, type: "number" },
        { header: "판매금액(원)", width: 16, type: "number" },
        { header: "만족도조사", width: 12, type: "center" },
        { header: "최초 입력", width: 17, type: "datetime" },
        { header: "최종 수정", width: 17, type: "datetime" },
        { header: "비고", width: 12, type: "center" },
      ],
      rows: detail,
    },
  ];
}


function pct(n: number, total: number): number {
  return total > 0 ? n / total : 0;
}

function reportSheets(companies: AdminCompany[], sales: SalesEntry[]): SheetSpec[] {
  const st = computeSalesStats(companies, sales);
  const lastDate = EVENT_DAYS[EVENT_DAYS.length - 1].date;
  const surveyDone = companies.filter((c) => st.get(c.id, lastDate)?.surveyDone).length;

  const dayRows: SheetSpec["rows"] = st.days.map((d) => [
    `${d.label} (${EVENT_DAYS.find((x) => x.date === d.date)?.weekday ?? ""})`,
    d.entered > 0 ? `${d.entered} / ${d.total}개` : NOT_ENTERED,
    d.entered > 0 ? pct(d.entered, d.total) : null,
    d.entered > 0 ? d.visitors : NOT_ENTERED,
    d.entered > 0 ? d.items : NOT_ENTERED,
    d.entered > 0 ? d.amount : NOT_ENTERED,
    d.entered > 0 ? Math.round(d.amount / d.entered) : NOT_ENTERED,
  ]);

  const ranked = st.byCompany.filter((c) => c.days > 0).sort((a, b) => b.amount - a.amount || b.items - a.items || a.name.localeCompare(b.name, "ko"));
  const topRows: SheetSpec["rows"] = ranked.slice(0, 10).map((c, i) => [i + 1, c.name, c.days + "일", c.items, c.amount, st.amount > 0 ? c.amount / st.amount : null]);

  const missingRows: SheetSpec["rows"] = [];
  for (const d of st.days) for (const c of d.missing) missingRows.push([`${d.short} (${EVENT_DAYS.find((x) => x.date === d.date)?.weekday ?? ""})`, c.name]);

  return [
    {
      name: "일자별 실적",
      heading: "일자별 실적 요약",
      columns: [
        { header: "행사 일자", width: 16, type: "center" },
        { header: "입력 업체", width: 14, type: "center" },
        { header: "입력률", width: 10, type: "percent" },
        { header: "부스 방문객(명)", width: 14, type: "number" },
        { header: "판매 건수", width: 13, type: "number" },
        { header: "판매금액(원)", width: 18, type: "number" },
        { header: "입력 업체 평균(원)", width: 18, type: "number" },
      ],
      rows: dayRows,
      totals: [
        "합계",
        st.companiesEntered > 0 ? `${st.companiesEntered} / ${st.companiesTotal}개` : NOT_ENTERED,
        st.companiesEntered > 0 ? pct(st.companiesEntered, st.companiesTotal) : null,
        st.companiesEntered > 0 ? st.visitors : NOT_ENTERED,
        st.companiesEntered > 0 ? st.items : NOT_ENTERED,
        st.companiesEntered > 0 ? st.amount : NOT_ENTERED,
        st.companiesEntered > 0 ? Math.round(st.amount / st.companiesEntered) : NOT_ENTERED,
      ],
    },
    {
      name: "상위 업체 TOP10",
      heading: "판매금액 상위 업체 (입력한 업체 기준)",
      columns: [
        { header: "순위", width: 7, type: "center" },
        { header: "업체명", width: 28 },
        { header: "입력 일수", width: 10, type: "center" },
        { header: "총 판매 건수", width: 14, type: "number" },
        { header: "총 판매금액(원)", width: 18, type: "number" },
        { header: "전체 대비 비중", width: 13, type: "percent" },
      ],
      rows: topRows,
    },
    {
      name: "미입력 업체",
      heading: "아직 입력하지 않은 업체 (일자별)",
      columns: [
        { header: "행사 일자", width: 16, type: "center" },
        { header: "업체명", width: 34 },
      ],
      rows: missingRows,
    },
    {
      name: "산출 기준",
      heading: "산출 기준",
      columns: [
        { header: "구분", width: 18, type: "center" },
        { header: "내용", width: 80 },
      ],
      rows: [
        ["판매실적", "참가업체가 업체 전용 화면에서 행사일(10/23 · 10/24 · 10/25)별로 직접 입력한 판매 상품 건수와 총 판매금액입니다."],
        ["입력률", "해당 일자에 판매실적을 제출한 업체 수 ÷ 전체 참가업체 수입니다."],
        ["미입력", "아직 제출하지 않은 값입니다. 0건 · 0원으로 입력한 값과 구분하며, 합계에는 포함되지 않습니다."],
        ["합계 행", "합계 행의 입력 업체는 3일 중 하루라도 입력한 업체 수이며, 입력 업체 평균은 판매금액 합계 ÷ 그 업체 수입니다."],
        ["입력 업체 평균", "판매금액 합계 ÷ 해당 일자에 입력한 업체 수입니다."],
        ["만족도조사", `10/25 제출 시 업체가 만족도조사 참여를 확인한 업체는 ${surveyDone} / ${companies.length}개입니다 (자체 확인 기준).`],
        ["유의사항", "업체가 제출 후에도 수정할 수 있어 수치는 조회 시점의 최신 값입니다."],
      ],
    },
  ];
}

export function buildExportDoc(type: ExportType, companies: AdminCompany[], baseUrl: string, sales: SalesEntry[] = []): ExportDoc {
  const sheets =
    type === "all"
      ? allSheets(companies)
      : type === "price-board"
        ? priceBoardSheets(companies)
        : type === "lucky-draw"
          ? luckyDrawSheets(companies)
          : type === "sales"
            ? salesSheets(companies, sales)
            : type === "sales-report"
              ? reportSheets(companies, sales)
              : linkSheets(companies, baseUrl);

  const [title, subtitle] = TITLES[type];
  const submitted = companies.filter((c) => c.submission).length;
  let kpis: ExportDoc["kpis"];
  if (type === "sales-report") {
    const st = computeSalesStats(companies, sales);
    const any = st.companiesEntered > 0;
    kpis = [
      ["입력 업체", `${st.companiesEntered} / ${st.companiesTotal}개 (${Math.round(pct(st.companiesEntered, st.companiesTotal) * 100)}%)`],
      ["총 부스 방문객", any ? `${st.visitors.toLocaleString("ko-KR")}명` : NOT_ENTERED],
      ["총 판매 건수", any ? `${st.items.toLocaleString("ko-KR")}건` : NOT_ENTERED],
      ["총 판매금액", any ? `${st.amount.toLocaleString("ko-KR")}원` : NOT_ENTERED],
    ];
  } else if (type === "sales") {
    const known = new Set(companies.map((c) => c.id));
    const rows = sales.filter((e) => e.companyId && known.has(e.companyId));
    const items = rows.reduce((a, e) => a + e.items, 0);
    const amount = rows.reduce((a, e) => a + e.amount, 0);
    const visitors = rows.reduce((a, e) => a + (e.visitors ?? 0), 0);
    const entered = new Set(rows.map((e) => e.companyId)).size;
    kpis = [
      ["입력 업체", `${entered} / ${companies.length}개`],
      ["총 부스 방문객", `${visitors.toLocaleString("ko-KR")}명`],
      ["총 판매 건수", `${items.toLocaleString("ko-KR")}건`],
      ["총 판매금액", `${amount.toLocaleString("ko-KR")}원`],
    ];
  } else {
    kpis = [
      ["참가업체", `${companies.length}개`],
      ["제출 완료", `${submitted}개`],
      ["미제출", `${companies.length - submitted}개`],
    ];
  }
  return { title, subtitle: `BEAUTY WAVE in INCHEON 2026 · ${subtitle}`, kpis, sheets };
}

export function buildImportTemplate(): ExportDoc {
  return {
    plain: true,
    title: "참가업체 일괄 등록 양식",
    subtitle: "A열에 업체명을 한 줄에 하나씩 입력한 뒤 업로드하세요 (예시 행은 자동으로 건너뜁니다)",
    sheets: [
      {
        name: "업체 명단",
        columns: [{ header: "업체명", width: 34 }],
        // '○○' 가 들어간 예시 행과 '업체명' 제목 행은 등록 시 자동으로 건너뜁니다.
        rows: [["주식회사 ○○뷰티"]],
      },
    ],
  };
}
