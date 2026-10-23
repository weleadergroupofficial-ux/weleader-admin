/**
 * 방문객 수 저장 보완 — DB 에 visitors 컬럼(migration_03)이 없을 때도 방문객 수가 누락되지 않도록
 * 감사로그(bw_audit_logs, action = 'sales_visitors')에 기록하고, 조회 시 판매실적에 합쳐 돌려줍니다.
 * migration_03 을 적용한 뒤에도 그대로 두어도 안전합니다(컬럼 값이 있으면 그 값을 우선 사용).
 */
import { rest } from "./supabase";

type Entry = { companyId?: string; day?: string; visitors?: number | null };

export async function saveVisitorsFallback(companyId: string, companyName: string, day: string, visitors: number) {
  await rest("bw_audit_logs", {
    method: "POST",
    body: { company_id: companyId, company_name: companyName, action: "sales_visitors", actor: "company", detail: { day, visitors } },
  });
}

export async function mergeVisitors<T extends Entry>(entries: T[] | null | undefined, companyId?: string): Promise<T[]> {
  const list = entries ?? [];
  if (!list.some((e) => e.visitors === null || e.visitors === undefined)) return list;
  let logs: { company_id: string | null; detail: { day?: string; visitors?: number } }[] = [];
  try {
    const q = `bw_audit_logs?select=company_id,detail&action=eq.sales_visitors${companyId ? `&company_id=eq.${encodeURIComponent(companyId)}` : ""}&order=created_at.asc&limit=10000`;
    logs = await rest(q);
  } catch {
    return list;
  }
  const m = new Map<string, number>();
  for (const l of logs) if (l.company_id && l.detail?.day && typeof l.detail.visitors === "number") m.set(`${l.company_id}|${l.detail.day}`, l.detail.visitors);
  return list.map((e) => {
    if (e.visitors !== null && e.visitors !== undefined) return e;
    const v = m.get(`${e.companyId}|${e.day}`);
    return v === undefined ? e : { ...e, visitors: v };
  });
}
