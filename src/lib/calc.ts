import type { Gift, GiftDraft, Submission, SubmissionDraft } from "./types";

/** 할인율(%) — 소수점 반올림, 정수 */
export function discountRate(regular: number | null | undefined, event: number | null | undefined): number | null {
  if (regular == null || event == null || !Number.isFinite(regular) || !Number.isFinite(event)) return null;
  if (regular <= 0 || event > regular) return null;
  return Math.round(((regular - event) / regular) * 100);
}

export function giftTotal(g: { quantity: number | null; unitPrice: number | null }): number {
  return (g.quantity ?? 0) * (g.unitPrice ?? 0);
}

export function giftSummary(gifts: Array<Gift | GiftDraft>) {
  let quantity = 0;
  let amount = 0;
  for (const g of gifts) {
    quantity += g.quantity ?? 0;
    amount += giftTotal(g);
  }
  return { kinds: gifts.length, quantity, amount };
}

export function submissionGiftSummary(s: Submission | SubmissionDraft | null) {
  if (!s || !s.luckyDrawProvided) return { kinds: 0, quantity: 0, amount: 0 };
  return giftSummary(s.gifts);
}

const won = new Intl.NumberFormat("ko-KR");
export function formatNumber(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "" : won.format(n);
}
export function formatWon(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "-" : `${won.format(n)}원`;
}

/** 한국 시간 기준 날짜 표시 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")}`;
}
