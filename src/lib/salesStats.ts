// 판매실적 집계 (관리자 화면 · 엑셀 · PDF 공통)
import { EVENT_DAYS, type SalesEntry } from "./event";

export interface StatCompany {
  id: string;
  name: string;
}

export interface DayStat {
  date: string;
  short: string;
  label: string;
  weekday: string;
  entered: number; // 입력한 업체 수
  total: number; // 전체 업체 수
  visitors: number;
  items: number;
  amount: number;
  missing: StatCompany[]; // 아직 입력하지 않은 업체
}

export interface CompanyTotal {
  id: string;
  name: string;
  visitors: number;
  items: number;
  amount: number;
  days: number; // 입력한 일수
}

export interface SalesStats {
  days: DayStat[];
  visitors: number;
  items: number;
  amount: number;
  companiesEntered: number; // 1일이라도 입력한 업체 수
  companiesTotal: number;
  byCompany: CompanyTotal[];
  /** 업체·일자별 입력 여부 */
  has: (companyId: string, date: string) => boolean;
  get: (companyId: string, date: string) => SalesEntry | undefined;
}

export function computeSalesStats(companies: StatCompany[], sales: SalesEntry[]): SalesStats {
  const known = new Set(companies.map((c) => c.id));
  const by = new Map<string, SalesEntry>();
  for (const e of sales) if (e.companyId && known.has(e.companyId)) by.set(`${e.companyId}|${e.day}`, e);

  const days: DayStat[] = EVENT_DAYS.map((d) => {
    let visitors = 0;
    let items = 0;
    let amount = 0;
    const missing: StatCompany[] = [];
    let entered = 0;
    for (const c of companies) {
      const e = by.get(`${c.id}|${d.date}`);
      if (e) {
        entered++;
        visitors += e.visitors ?? 0;
        items += e.items;
        amount += e.amount;
      } else missing.push(c);
    }
    return { date: d.date, short: d.short, label: d.label, weekday: d.weekday, entered, total: companies.length, visitors, items, amount, missing };
  });

  const byCompany: CompanyTotal[] = companies.map((c) => {
    let visitors = 0;
    let items = 0;
    let amount = 0;
    let n = 0;
    for (const d of EVENT_DAYS) {
      const e = by.get(`${c.id}|${d.date}`);
      if (e) {
        visitors += e.visitors ?? 0;
        items += e.items;
        amount += e.amount;
        n++;
      }
    }
    return { id: c.id, name: c.name, visitors, items, amount, days: n };
  });

  return {
    days,
    visitors: days.reduce((a, d) => a + d.visitors, 0),
    items: days.reduce((a, d) => a + d.items, 0),
    amount: days.reduce((a, d) => a + d.amount, 0),
    companiesEntered: byCompany.filter((c) => c.days > 0).length,
    companiesTotal: companies.length,
    byCompany,
    has: (id, date) => by.has(`${id}|${date}`),
    get: (id, date) => by.get(`${id}|${date}`),
  };
}

export const pctText = (n: number, total: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : "0%");
