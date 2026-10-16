// 행사 일정 · 판매실적 입력 규칙 (클라이언트·서버 공통)

export interface EventDay {
  date: string; // YYYY-MM-DD
  label: string; // 10월 23일
  short: string; // 10/23
  weekday: string;
  last: boolean; // 행사 마지막 날 (만족도조사 필수)
}

export const EVENT_DAYS: EventDay[] = [
  { date: "2026-10-23", label: "10월 23일", short: "10/23", weekday: "금", last: false },
  { date: "2026-10-24", label: "10월 24일", short: "10/24", weekday: "토", last: false },
  { date: "2026-10-25", label: "10월 25일", short: "10/25", weekday: "일", last: true },
];

export const EVENT_DATES = EVENT_DAYS.map((d) => d.date);

/** 만족도조사(구글폼) 주소 */
export const DEFAULT_SURVEY_URL = "https://forms.gle/2v9VWcqW82pRf4mX7";

export const MAX_SALES_ITEMS = 1_000_000;
export const MAX_SALES_AMOUNT = 10_000_000_000;

export interface SalesEntry {
  companyId?: string;
  day: string;
  items: number;
  amount: number;
  surveyDone: boolean;
  revision: number;
  firstSubmittedAt: string;
  updatedAt: string;
}

export interface SalesState {
  company: { name: string };
  entries: SalesEntry[];
  surveyUrl: string;
}

/** 한국 시간 기준 오늘 날짜(YYYY-MM-DD) */
export function todayKst(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function validateSales(raw: unknown): { ok: true; items: number; amount: number; surveyDone: boolean } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
  if (!isInt(o.items) || o.items < 0 || o.items > MAX_SALES_ITEMS) errors.items = "판매 상품 건수를 0 이상의 숫자로 입력해 주세요.";
  if (!isInt(o.amount) || o.amount < 0 || o.amount > MAX_SALES_AMOUNT) errors.amount = "총 판매금액을 0 이상의 숫자(원)로 입력해 주세요.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, items: o.items as number, amount: o.amount as number, surveyDone: o.surveyDone === true };
}
