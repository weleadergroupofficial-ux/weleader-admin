"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, downloadFile, focusFirstError, navigate, replaceUrl } from "@/lib/client";
import { formatDateTime, formatNumber, formatWon, giftTotal, submissionGiftSummary } from "@/lib/calc";
import type { AdminCompany, AdminOverview, AuditLog, FieldErrors, Submission, SubmissionDraft } from "@/lib/types";
import { draftFromSubmission, draftToPayload, validateSubmission } from "@/lib/validation";
import { EVENT_DAYS, todayKst, type SalesEntry } from "@/lib/event";
import { computeSalesStats, pctText, type SalesStats } from "@/lib/salesStats";
import { SubmissionEditor } from "../SubmissionEditor";
import { SubmissionSummary } from "../SubmissionSummary";
import { Spinner, Wordmark } from "../ui/fields";

export type AdminView = "dashboard" | "companies" | "company" | "lucky-draw" | "sales" | "downloads" | "logs";

// ---------------------------------------------------------------------
// 공용 도구
// ---------------------------------------------------------------------

type Toast = { text: string; error?: boolean } | null;
type Confirm = { title: string; body: ReactNode; action: string; danger?: boolean; run: () => Promise<void> } | null;

function linkFor(token: string) {
  return `${window.location.origin}/s/${token}`;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function useAdminData() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      const d = await api<AdminOverview>("/api/admin/overview");
      setData(d);
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        navigate("/admin/login");
        return;
      }
      setError(e instanceof Error ? e.message : "데이터를 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => {
    reload();
    // 다른 탭/창에서 돌아오면 최신 데이터로 갱신, 30초마다 자동 갱신
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 30000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(t);
    };
  }, [reload]);
  return { data, error, reload };
}


function useSales() {
  const [rows, setRows] = useState<SalesEntry[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setRows(await api<SalesEntry[]>("/api/admin/sales"));
      setError("");
    } catch (e) {
      // 판매실적 DB 설정 전이어도 대시보드 나머지는 정상 동작해야 하므로 조용히 표시만 합니다.
      setError(e instanceof Error ? e.message : "판매실적을 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30000);
    return () => clearInterval(t);
  }, [load]);
  return { rows, error, reload: load };
}

function SalesChips({ id, stats }: { id: string; stats: SalesStats }) {
  const last = EVENT_DAYS[EVENT_DAYS.length - 1].date;
  return (
    <span className="sales-chips">
      {EVENT_DAYS.map((d) => {
        const e = stats.get(id, d.date);
        return (
          <span key={d.date} className={`sales-chip ${e ? "done" : "todo"}`} title={`${d.short} ${e ? "입력 완료" : "미입력"}`}>
            {d.short.slice(3)}일 {e ? "✓" : "–"}
          </span>
        );
      })}
      {stats.has(id, last) && !stats.get(id, last)?.surveyDone && (
        <span className="sales-chip warn" title="10/25 만족도조사 미완료">
          설문 ✕
        </span>
      )}
    </span>
  );
}

function SalesProgress({ stats, loaded, error, notify }: { stats: SalesStats; loaded: boolean; error: string; notify: Ctx["notify"] }) {
  const today = todayKst();
  const initial = EVENT_DAYS.find((d) => d.date === today)?.date ?? EVENT_DAYS.find((d) => stats.days.find((x) => x.date === d.date)?.missing.length)?.date ?? EVENT_DAYS[0].date;
  const [sel, setSel] = useState<string>(initial);
  const day = stats.days.find((d) => d.date === sel) ?? stats.days[0];

  if (error && !loaded) {
    return (
      <div className="panel sales-progress">
        <div className="panel-head">
          <h2>판매실적 입력 현황</h2>
        </div>
        <div className="notice notice-error">{error}</div>
      </div>
    );
  }

  async function copyReminder() {
    const wd = EVENT_DAYS.find((d) => d.date === day.date)?.weekday ?? "";
    const text = [
      `[BEAUTY WAVE in INCHEON 2026] ${day.short}(${wd}) 판매실적 입력 안내`,
      day.missing.length ? `아직 입력하지 않으신 업체: ${day.missing.map((c) => c.name).join(", ")}` : "모든 업체가 입력을 마쳤습니다.",
      "참가업체 접속 링크에서 업체명을 선택하고 담당자 휴대폰 뒷 4자리를 입력한 뒤 [행사 판매실적 입력하기]를 눌러 판매 상품 건수와 총 금액을 입력해 주세요.",
      window.location.origin,
      "운영팀 : 주식회사 웰리더",
    ].join("\n");
    const ok = await copyText(text);
    notify(ok ? "미입력 업체 안내문을 복사했습니다. 단톡방에 붙여넣으세요." : "복사하지 못했습니다.", !ok);
  }

  return (
    <div className="panel sales-progress">
      <div className="panel-head">
        <h2>판매실적 입력 현황</h2>
        <a className="link-btn small" href="/admin/sales">
          판매실적 자세히 보기
        </a>
      </div>
      <div className="sp-days" role="tablist">
        {stats.days.map((d) => {
          const full = d.total > 0 && d.entered === d.total;
          return (
            <button key={d.date} role="tab" aria-selected={d.date === day.date} className={`sp-day${d.date === day.date ? " on" : ""}`} onClick={() => setSel(d.date)}>
              <span className="sp-d">
                {d.short} ({d.weekday}){d.date === todayKst() && <em>오늘</em>}
              </span>
              <span className="sp-n">
                {d.entered}
                <small> / {d.total}곳</small>
              </span>
              <span className="progress" aria-label={`${d.short} 입력률 ${pctText(d.entered, d.total)}`}>
                <span style={{ width: pctText(d.entered, d.total) }} />
              </span>
              <span className="sp-s">{full ? "전체 입력 완료" : `미입력 ${d.missing.length}곳`}</span>
            </button>
          );
        })}
      </div>
      <div className="sp-missing">
        <div className="sp-missing-head">
          <strong>
            {day.short} 아직 입력하지 않은 업체 <span className="num">{day.missing.length}</span>곳
          </strong>
          <button className="btn btn-soft btn-sm" onClick={copyReminder} disabled={day.missing.length === 0}>
            미입력 업체 안내문 복사
          </button>
        </div>
        {day.missing.length === 0 ? (
          <p className="muted small">모든 업체가 입력했습니다.</p>
        ) : (
          <div className="sp-names">
            {day.missing.map((c) => (
              <a key={c.id} className="sp-name" href={`/admin/companies/${c.id}`}>
                {c.name}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ c }: { c: AdminCompany }) {
  return c.submission ? <span className="status done">제출 완료</span> : <span className="status todo">미제출</span>;
}

// ---------------------------------------------------------------------
// 셸
// ---------------------------------------------------------------------

export default function AdminApp({ view, companyId, edit }: { view: AdminView; companyId?: string; edit?: boolean }) {
  const { data, error, reload } = useAdminData();
  const [toast, setToast] = useState<Toast>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((text: string, isError = false) => {
    setToast({ text, error: isError });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), isError ? 5000 : 2600);
  }, []);

  const ctx: Ctx = {
    data: data!,
    reload,
    notify,
    ask: setConfirm,
  };

  async function logout() {
    try {
      await api("/api/admin/logout", { method: "POST" });
    } finally {
      navigate("/admin/login");
    }
  }

  const companies = data?.companies ?? [];
  const submitted = companies.filter((c) => c.submission).length;

  const nav: Array<[string, string, AdminView[], string?]> = [
    ["/admin", "대시보드", ["dashboard"]],
    ["/admin/companies", "업체 · 링크 관리", ["companies", "company"], data ? String(companies.length) : undefined],
    ["/admin/lucky-draw", "럭키드로우 관리", ["lucky-draw"]],
    ["/admin/sales", "판매실적", ["sales"]],
    ["/admin/downloads", "다운로드 (엑셀·PDF)", ["downloads"]],
    ["/admin/logs", "작업 이력", ["logs"]],
  ];

  return (
    <div className="ad-shell">
      <aside className="ad-side">
        <div className="ad-brand">
          <Wordmark />
          <div className="ad-role">웰리더 운영사무국 · 관리자</div>
        </div>
        <nav className="ad-nav" aria-label="관리자 메뉴">
          {nav.map(([href, label, views, count]) => (
            <a key={href} href={href} className={views.includes(view) ? "active" : ""} aria-current={views.includes(view) ? "page" : undefined}>
              {label}
              {count && <span className="count">{count}</span>}
            </a>
          ))}
        </nav>
        <div className="ad-side-foot">
          {data && (
            <span>
              제출 {submitted} / {companies.length}개사
            </span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={logout}>
            로그아웃
          </button>
        </div>
      </aside>

      <main className="ad-main">
        {!data && !error && (
          <div className="state-screen">
            <Spinner />
          </div>
        )}
        {error && !data && (
          <div className="state-screen">
            <div>
              <h2>데이터를 불러오지 못했습니다</h2>
              <p>{error}</p>
              <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={reload}>
                다시 시도
              </button>
            </div>
          </div>
        )}
        {data && (
          <>
            {error && (
              <div className="notice notice-error" style={{ marginBottom: 16 }}>
                최신 데이터를 불러오지 못했습니다: {error}
              </div>
            )}
            {view === "dashboard" && <Dashboard ctx={ctx} />}
            {view === "companies" && <Companies ctx={ctx} />}
            {view === "company" && companyId && <CompanyDetail ctx={ctx} id={companyId} startEditing={!!edit} />}
            {view === "lucky-draw" && <LuckyDraw ctx={ctx} />}
            {view === "sales" && <SalesAdmin ctx={ctx} />}
            {view === "downloads" && <Downloads ctx={ctx} />}
            {view === "logs" && <Logs ctx={ctx} />}
          </>
        )}
      </main>

      {toast && (
        <div className={`toast${toast.error ? " error" : ""}`} role="status">
          {toast.text}
        </div>
      )}
      {confirm && (
        <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="cf-title" onClick={() => !confirmBusy && setConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="cf-title">{confirm.title}</h3>
            <p>{confirm.body}</p>
            <div className="actions">
              <button className="btn btn-ghost" disabled={confirmBusy} onClick={() => setConfirm(null)} autoFocus>
                취소
              </button>
              <button
                className={`btn ${confirm.danger ? "btn-danger" : "btn-primary"}`}
                disabled={confirmBusy}
                onClick={async () => {
                  setConfirmBusy(true);
                  try {
                    await confirm.run();
                    setConfirm(null);
                  } catch (e) {
                    notify(e instanceof Error ? e.message : "처리하지 못했습니다.", true);
                  } finally {
                    setConfirmBusy(false);
                  }
                }}
              >
                {confirmBusy ? "처리 중…" : confirm.action}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface Ctx {
  data: AdminOverview;
  reload: () => Promise<void>;
  notify: (text: string, isError?: boolean) => void;
  ask: (c: Confirm) => void;
}

function useDownload(notify: Ctx["notify"]) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (type: string, format: "xlsx" | "pdf" = "xlsx") => {
    setBusy(format === "pdf" ? `${type}.pdf` : type);
    try {
      await downloadFile(type === "template" ? "/api/admin/template" : `/api/admin/export/${type}${format === "pdf" ? "?format=pdf" : ""}`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "다운로드하지 못했습니다.", true);
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

// ---------------------------------------------------------------------
// 대시보드
// ---------------------------------------------------------------------

function Dashboard({ ctx }: { ctx: Ctx }) {
  const { companies, settings } = ctx.data;
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "done" | "todo">("all");
  const dl = useDownload(ctx.notify);
  const sales = useSales();
  const salesStats = useMemo(() => computeSalesStats(companies, sales.rows ?? []), [companies, sales.rows]);

  const total = companies.length;
  const submitted = companies.filter((c) => c.submission).length;
  const lucky = companies.filter((c) => c.submission?.luckyDrawProvided);
  const luckyQty = lucky.reduce((a, c) => a + submissionGiftSummary(c.submission).quantity, 0);
  const pct = total ? Math.round((submitted / total) * 100) : 0;

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return companies
      .map((c, i) => ({ c, no: i + 1 }))
      .filter(({ c }) => (filter === "all" ? true : filter === "done" ? !!c.submission : !c.submission))
      .filter(({ c }) => !term || c.name.toLowerCase().includes(term) || (c.submission?.companyName.toLowerCase().includes(term) ?? false));
  }, [companies, q, filter]);

  async function toggleOpen(open: boolean) {
    try {
      await api("/api/admin/settings", { method: "PATCH", json: { submissionOpen: open } });
      await ctx.reload();
      ctx.notify(open ? "제출 접수를 다시 열었습니다." : "제출 접수를 마감했습니다. 참가업체는 더 이상 수정할 수 없습니다.");
    } catch (e) {
      ctx.notify(e instanceof Error ? e.message : "변경하지 못했습니다.", true);
    }
  }

  return (
    <>
      <div className="ad-top">
        <div>
          <h1>대시보드</h1>
          <p>참가업체 제출 현황을 실시간으로 확인합니다. 화면은 30초마다 자동으로 갱신됩니다.</p>
        </div>
        <div className="ad-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => ctx.reload().then(() => ctx.notify("최신 데이터로 갱신했습니다."))}>
            새로고침
          </button>
          <button className="btn btn-primary btn-sm" disabled={dl.busy === "all"} onClick={() => dl.run("all")}>
            {dl.busy === "all" ? "만드는 중…" : "전체 데이터 엑셀"}
          </button>
          <button className="btn btn-soft btn-sm" disabled={dl.busy === "all.pdf"} onClick={() => dl.run("all", "pdf")}>
            {dl.busy === "all.pdf" ? "만드는 중…" : "전체 데이터 PDF"}
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">전체 참가업체</div>
          <div className="value num">
            {total}
            <small>개사</small>
          </div>
          <div className="sub">사전 등록된 업체 수</div>
        </div>
        <div className="stat accent">
          <div className="label">제출 완료</div>
          <div className="value num">
            {submitted}
            <small>개사</small>
          </div>
          <div className="progress" aria-label={`제출률 ${pct}%`}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="sub">제출률 {pct}%</div>
        </div>
        <div className="stat">
          <div className="label">미제출</div>
          <div className="value num">
            {total - submitted}
            <small>개사</small>
          </div>
          <div className="sub">
            {total - submitted > 0 ? (
              <button className="link-btn small" onClick={() => setFilter("todo")}>
                미제출 업체 보기
              </button>
            ) : (
              "모두 제출했습니다"
            )}
          </div>
        </div>
        <div className="stat">
          <div className="label">럭키드로우 제공 업체</div>
          <div className="value num">
            {lucky.length}
            <small>개사</small>
          </div>
          <div className="sub">제출 업체 기준</div>
        </div>
        <div className="stat">
          <div className="label">럭키드로우 총 제공 수량</div>
          <div className="value num">
            {formatNumber(luckyQty)}
            <small>개</small>
          </div>
          <div className="sub">
            <a href="/admin/lucky-draw">경품 상세 보기</a>
          </div>
        </div>
      </div>

      <SalesProgress stats={salesStats} loaded={sales.rows !== null} error={sales.error} notify={ctx.notify} />

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>업체별 제출 현황</h2>
            <p>
              {settings.submissionOpen ? "제출 접수 중 — 참가업체가 링크로 제출하고 수정할 수 있습니다." : "제출 마감됨 — 참가업체는 제출 내용을 볼 수만 있습니다."}
            </p>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={settings.submissionOpen} onChange={(e) => toggleOpen(e.target.checked)} />
            제출 접수
          </label>
        </div>
        <div className="toolbar">
          <input
            className="search"
            type="search"
            placeholder="업체명 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="업체명 검색"
          />
          <div className="seg" role="group" aria-label="제출 상태 필터">
            {(
              [
                ["all", `전체 ${total}`],
                ["done", `제출 완료 ${submitted}`],
                ["todo", `미제출 ${total - submitted}`],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={filter === k ? "on" : ""} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {total === 0 ? (
          <div className="empty">
            <strong>등록된 참가업체가 없습니다</strong>
            업체 명단을 먼저 등록하면 업체별 전용 제출 링크가 만들어집니다.
            <div style={{ marginTop: 14 }}>
              <a className="btn btn-primary btn-sm" href="/admin/companies">
                참가업체 등록하기
              </a>
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="c">순번</th>
                  <th>업체명</th>
                  <th className="c">제출 여부</th>
                  <th>판매실적 (10/23~25)</th>
                  <th className="r">대표 판매상품 수</th>
                  <th className="c">럭키드로우</th>
                  <th className="r">럭키드로우 수량</th>
                  <th>최종 제출일</th>
                  <th className="r">관리</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, no }) => {
                  const s = c.submission;
                  const g = submissionGiftSummary(s);
                  return (
                    <tr key={c.id}>
                      <td className="c num">{no}</td>
                      <td style={{ minWidth: 160 }}>
                        <a href={`/admin/companies/${c.id}`} style={{ fontWeight: 650, color: "var(--ink)" }}>
                          {c.name}
                        </a>
                        {s && s.companyName !== c.name && <div className="small muted">제출명: {s.companyName}</div>}
                        {c.isLocked && (
                          <span className="status lock" style={{ marginLeft: 6 }}>
                            잠금
                          </span>
                        )}
                      </td>
                      <td className="c">
                        <StatusBadge c={c} />
                      </td>
                      <td>{sales.rows ? <SalesChips id={c.id} stats={salesStats} /> : <span className="muted">-</span>}</td>
                      <td className="r">{s ? `${s.products.length}개` : "-"}</td>
                      <td className="c">{s ? (s.luckyDrawProvided ? "제공" : "미제공") : "-"}</td>
                      <td className="r">{s?.luckyDrawProvided ? `${formatNumber(g.quantity)}개` : "-"}</td>
                      <td className="num" style={{ whiteSpace: "nowrap" }}>
                        {s ? formatDateTime(s.updatedAt) : "-"}
                      </td>
                      <td>
                        <div className="row-actions">
                          <a className="btn btn-ghost btn-sm" href={`/admin/companies/${c.id}`}>
                            상세보기
                          </a>
                          <a className="btn btn-soft btn-sm" href={`/admin/companies/${c.id}?edit=1`}>
                            수정
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9}>
                      <div className="empty">조건에 맞는 업체가 없습니다.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// 업체 · 링크 관리
// ---------------------------------------------------------------------

function Companies({ ctx }: { ctx: Ctx }) {
  const { companies } = ctx.data;
  const [names, setNames] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ added: string[]; skipped: string[] } | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dl = useDownload(ctx.notify);

  async function addNames() {
    const list = names
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length === 0) {
      ctx.notify("등록할 업체명을 한 줄에 하나씩 입력해 주세요.", true);
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ added: string[]; skipped: string[] }>("/api/admin/companies", { method: "POST", json: { names: list } });
      setResult(r);
      setNames("");
      await ctx.reload();
      ctx.notify(`${r.added.length}개 업체를 등록했습니다.`);
    } catch (e) {
      ctx.notify(e instanceof Error ? e.message : "등록하지 못했습니다.", true);
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api<{ added: string[]; skipped: string[] }>("/api/admin/companies/import", { method: "POST", body: fd });
      setResult(r);
      await ctx.reload();
      ctx.notify(`파일에서 ${r.added.length}개 업체를 등록했습니다.`);
    } catch (e) {
      ctx.notify(e instanceof Error ? e.message : "파일을 등록하지 못했습니다.", true);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function saveName() {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      ctx.notify("업체명을 입력해 주세요.", true);
      return;
    }
    try {
      await api(`/api/admin/companies/${editing.id}`, { method: "PATCH", json: { name } });
      setEditing(null);
      await ctx.reload();
      ctx.notify("업체명을 변경했습니다.");
    } catch (e) {
      ctx.notify(e instanceof Error ? e.message : "변경하지 못했습니다.", true);
    }
  }

  const [codeEdit, setCodeEdit] = useState<{ id: string; code: string } | null>(null);
  async function saveCode() {
    if (!codeEdit) return;
    if (codeEdit.code !== "" && !/^[0-9]{4}$/.test(codeEdit.code)) {
      ctx.notify("확인번호는 숫자 4자리로 입력해 주세요.", true);
      return;
    }
    try {
      await api(`/api/admin/companies/${codeEdit.id}`, { method: "PATCH", json: { verifyCode: codeEdit.code || null } });
      setCodeEdit(null);
      await ctx.reload();
      ctx.notify("확인번호를 저장했습니다.");
    } catch (e) {
      ctx.notify(e instanceof Error ? e.message : "저장하지 못했습니다.", true);
    }
  }

  async function setLock(c: AdminCompany, isLocked: boolean) {
    try {
      await api(`/api/admin/companies/${c.id}`, { method: "PATCH", json: { isLocked } });
      await ctx.reload();
      ctx.notify(isLocked ? `${c.name}: 수정 잠금을 걸었습니다.` : `${c.name}: 수정 잠금을 풀었습니다.`);
    } catch (e) {
      ctx.notify(e instanceof Error ? e.message : "변경하지 못했습니다.", true);
    }
  }

  async function copyAll() {
    const text = companies.map((c) => `${c.name}\t${linkFor(c.token)}`).join("\n");
    (await copyText(text)) ? ctx.notify(`${companies.length}개 업체의 링크를 복사했습니다. 엑셀이나 메신저에 붙여넣으세요.`) : ctx.notify("복사하지 못했습니다.", true);
  }

  return (
    <>
      <div className="ad-top">
        <div>
          <h1>업체 · 링크 관리</h1>
          <p>
            단톡방 공용 링크(사이트 첫 화면 주소)로 들어온 업체는 업체명과 확인번호(담당자 휴대폰 뒷자리)로 본인을 확인합니다. 업체별 전용 링크도 그대로 쓸 수 있습니다.
          </p>
        </div>
        <div className="ad-actions">
          <button className="btn btn-ghost btn-sm" disabled={!companies.length} onClick={copyAll}>
            전체 링크 복사
          </button>
          <button className="btn btn-ghost btn-sm" disabled={!companies.length || dl.busy === "links"} onClick={() => dl.run("links")}>
            링크 목록 엑셀
          </button>
        </div>
      </div>

      <div className="split">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>업체명 직접 입력</h2>
              <p>한 줄에 한 업체씩 입력하세요. 이미 등록된 이름은 건너뜁니다.</p>
            </div>
          </div>
          <textarea
            className="textarea"
            rows={6}
            value={names}
            onChange={(e) => setNames(e.target.value)}
            placeholder={"주식회사 ○○뷰티\n△△코스메틱\n□□랩"}
            aria-label="등록할 업체명 목록"
          />
          <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span className="small muted">{names.split(/\r?\n/).filter((s) => s.trim()).length}개 입력됨</span>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={addNames}>
              업체 등록
            </button>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>엑셀로 일괄 등록</h2>
              <p>양식의 A열에 업체명을 입력해 올리세요. 엑셀(.xlsx)과 CSV 파일을 받습니다.</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-ghost btn-sm" disabled={dl.busy === "template"} onClick={() => dl.run("template")}>
              등록 양식 내려받기
            </button>
            <label className={`btn btn-soft btn-sm${busy ? " disabled" : ""}`} style={{ cursor: busy ? "not-allowed" : "pointer" }}>
              파일 선택해 등록
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importFile(f);
                }}
              />
            </label>
          </div>
          {result && (
            <div className="notice notice-ok" style={{ marginTop: 14 }}>
              <strong>등록 {result.added.length}개 · 건너뜀 {result.skipped.length}개</strong>
              {result.skipped.length > 0 && <span className="small">이미 있는 업체: {result.skipped.join(", ")}</span>}
            </div>
          )}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <div>
            <h2>등록된 참가업체 {companies.length}개사</h2>
            <p>링크를 복사해 업체 담당자에게 전달하세요. 링크가 외부에 유출되면 ‘링크 재발급’으로 이전 링크를 무효화할 수 있습니다.</p>
          </div>
        </div>
        {companies.length === 0 ? (
          <div className="empty">
            <strong>아직 등록된 업체가 없습니다</strong>위에서 업체명을 입력하거나 엑셀 파일로 등록하세요.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="c">순번</th>
                  <th>업체명</th>
                  <th className="c">제출 여부</th>
                  <th>전용 제출 링크</th>
                  <th className="c">확인번호</th>
                  <th className="c">수정 잠금</th>
                  <th className="r">관리</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c, i) => (
                  <tr key={c.id}>
                    <td className="c num">{i + 1}</td>
                    <td style={{ minWidth: 180 }}>
                      {editing?.id === c.id ? (
                        <div style={{ display: "flex", gap: 6 }}>
                          <input
                            className="search"
                            style={{ minHeight: 36 }}
                            value={editing.name}
                            maxLength={100}
                            autoFocus
                            aria-label="업체명"
                            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveName();
                              if (e.key === "Escape") setEditing(null);
                            }}
                          />
                          <button className="btn btn-primary btn-sm" onClick={saveName}>
                            저장
                          </button>
                        </div>
                      ) : (
                        <a href={`/admin/companies/${c.id}`} style={{ fontWeight: 650, color: "var(--ink)" }}>
                          {c.name}
                        </a>
                      )}
                    </td>
                    <td className="c">
                      <StatusBadge c={c} />
                    </td>
                    <td>
                      <div className="link-cell">
                        <code title={linkFor(c.token)}>/s/{c.token.slice(0, 10)}…</code>
                        <button
                          className="btn btn-soft btn-sm"
                          onClick={async () =>
                            (await copyText(linkFor(c.token))) ? ctx.notify(`${c.name} 링크를 복사했습니다.`) : ctx.notify("복사하지 못했습니다.", true)
                          }
                        >
                          복사
                        </button>
                        <a className="btn btn-ghost btn-sm" href={`/s/${c.token}`} target="_blank" rel="noreferrer">
                          열기
                        </a>
                      </div>
                    </td>
                    <td className="c">
                      {codeEdit?.id === c.id ? (
                        <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                          <input
                            className="search num"
                            style={{ minHeight: 36, width: 76, flex: "none", textAlign: "center" }}
                            value={codeEdit.code}
                            inputMode="numeric"
                            maxLength={4}
                            autoFocus
                            aria-label={`${c.name} 확인번호`}
                            onChange={(e) => setCodeEdit({ ...codeEdit, code: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveCode();
                              if (e.key === "Escape") setCodeEdit(null);
                            }}
                          />
                          <button className="btn btn-primary btn-sm" onClick={saveCode}>
                            저장
                          </button>
                        </div>
                      ) : (
                        <button
                          className="link-btn num"
                          title="담당자 휴대폰 뒷자리 4자리 (단톡방 공용 링크 접속용)"
                          onClick={() => setCodeEdit({ id: c.id, code: c.verifyCode ?? "" })}
                        >
                          {c.verifyCode ?? "미설정"}
                        </button>
                      )}
                    </td>
                    <td className="c">
                      <label className="toggle" title="잠그면 참가업체가 수정할 수 없습니다">
                        <input type="checkbox" checked={c.isLocked} onChange={(e) => setLock(c, e.target.checked)} aria-label={`${c.name} 수정 잠금`} />
                      </label>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ id: c.id, name: c.name })}>
                          이름 변경
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            ctx.ask({
                              title: "링크를 재발급할까요?",
                              body: `${c.name}의 기존 링크는 즉시 사용할 수 없게 됩니다. 새 링크를 업체에 다시 전달해야 합니다. 제출된 정보는 그대로 유지됩니다.`,
                              action: "재발급",
                              run: async () => {
                                await api(`/api/admin/companies/${c.id}/token`, { method: "POST" });
                                await ctx.reload();
                                ctx.notify("새 링크를 발급했습니다. 복사해서 다시 전달해 주세요.");
                              },
                            })
                          }
                        >
                          링크 재발급
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() =>
                            ctx.ask({
                              title: "업체를 삭제할까요?",
                              body: `${c.name}${c.submission ? "와 제출된 모든 정보" : ""}가 삭제되고 링크도 사용할 수 없게 됩니다. 삭제 내역은 작업 이력에 남습니다.`,
                              action: "삭제",
                              danger: true,
                              run: async () => {
                                await api(`/api/admin/companies/${c.id}`, { method: "DELETE" });
                                await ctx.reload();
                                ctx.notify(`${c.name}을(를) 삭제했습니다.`);
                              },
                            })
                          }
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// 업체 상세 · 수정
// ---------------------------------------------------------------------

const ACTION_LABEL: Record<string, string> = {
  submission_created: "최초 제출",
  submission_updated: "제출 내용 수정",
  submission_deleted: "제출 내용 삭제",
  company_created: "업체 등록",
  company_updated: "업체 정보 변경",
  company_deleted: "업체 삭제",
  token_regenerated: "링크 재발급",
  settings_updated: "제출 접수 설정 변경",
  sales_created: "판매실적 최초 제출",
  sales_updated: "판매실적 수정",
};

function CompanyDetail({ ctx, id, startEditing }: { ctx: Ctx; id: string; startEditing: boolean }) {
  const c = ctx.data.companies.find((x) => x.id === id);
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState<SubmissionDraft | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const baseRevision = useRef<number | null>(null);

  useEffect(() => {
    if (editing && c && !draft) {
      setDraft(draftFromSubmission(c.submission, c.name));
      baseRevision.current = c.submission?.revision ?? null;
    }
  }, [editing, c, draft]);

  useEffect(() => {
    api<AuditLog[]>("/api/admin/logs")
      .then((l) => setLogs(l.filter((x) => x.companyId === id)))
      .catch(() => setLogs([]));
  }, [id, c?.submission?.revision]);

  if (!c) {
    return (
      <div className="empty">
        <strong>업체를 찾을 수 없습니다</strong>삭제되었거나 주소가 잘못되었습니다.
        <div style={{ marginTop: 14 }}>
          <a className="btn btn-ghost btn-sm" href="/admin">
            대시보드로 돌아가기
          </a>
        </div>
      </div>
    );
  }
  const s = c.submission;

  function update(next: SubmissionDraft) {
    setDraft(next);
    if (tried) {
      const v = validateSubmission(draftToPayload(next));
      setErrors(v.ok ? {} : v.errors);
    }
  }

  async function save() {
    if (!draft || !c) return;
    setTried(true);
    const v = validateSubmission(draftToPayload(draft));
    if (!v.ok) {
      setErrors(v.errors);
      setFormError(`확인이 필요한 항목이 ${Object.keys(v.errors).length}개 있습니다.`);
      focusFirstError();
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await api<{ submission: Submission }>(`/api/admin/companies/${c.id}/submission`, {
        method: "PUT",
        json: { expectedRevision: baseRevision.current, data: v.value },
      });
      await ctx.reload();
      setEditing(false);
      setDraft(null);
      setErrors({});
      setTried(false);
      replaceUrl(`/admin/companies/${c.id}`);
      ctx.notify("수정 내용을 저장했습니다.");
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.fieldErrors) setErrors(err.fieldErrors);
      setFormError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setEditing(false);
    setDraft(null);
    setErrors({});
    setTried(false);
    setFormError("");
    replaceUrl(`/admin/companies/${c!.id}`);
  }

  return (
    <>
      <a className="back-link" href="/admin">
        ← 제출 현황으로
      </a>
      <div className="ad-top">
        <div>
          <h1>{c.name}</h1>
          <p style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <StatusBadge c={c} />
            {c.isLocked && <span className="status lock">수정 잠금</span>}
            {s && (
              <span>
                최초 제출 {formatDateTime(s.firstSubmittedAt)} · 최종 수정 {formatDateTime(s.updatedAt)} ({s.updatedBy === "admin" ? "운영사무국" : "참가업체"}
                ) · {s.revision}번째 저장
              </span>
            )}
          </p>
        </div>
        {!editing && (
          <div className="ad-actions">
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => ((await copyText(linkFor(c.token))) ? ctx.notify("전용 링크를 복사했습니다.") : ctx.notify("복사하지 못했습니다.", true))}
            >
              전용 링크 복사
            </button>
            {s && (
              <button
                className="btn btn-danger btn-sm"
                onClick={() =>
                  ctx.ask({
                    title: "제출 내용을 삭제할까요?",
                    body: `${c.name}의 제출 정보가 모두 삭제되고 ‘미제출’ 상태로 돌아갑니다. 업체는 같은 링크로 다시 제출할 수 있으며, 삭제 전 내용은 작업 이력에 남습니다.`,
                    action: "제출 내용 삭제",
                    danger: true,
                    run: async () => {
                      await api(`/api/admin/companies/${c.id}/submission`, { method: "DELETE" });
                      await ctx.reload();
                      ctx.notify("제출 내용을 삭제했습니다.");
                    },
                  })
                }
              >
                제출 내용 삭제
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>
              {s ? "제출 내용 수정" : "대신 입력하기"}
            </button>
          </div>
        )}
      </div>

      {editing && draft ? (
        <div style={{ maxWidth: 960 }}>
          <div className="notice notice-info">
            운영사무국 권한으로 {s ? "제출 내용을 수정" : "업체 정보를 대신 입력"}합니다. 저장하면 참가업체 화면에도 바로 반영되고, 변경 내역은 작업 이력에 남습니다.
          </div>
          <SubmissionEditor value={draft} onChange={update} errors={errors} />
          {formError && (
            <div className="notice notice-error" role="alert" style={{ marginTop: 18 }}>
              {formError}
            </div>
          )}
          <div className="action-bar" style={{ background: "linear-gradient(180deg, rgba(247,244,253,0) 0, var(--mist) 30%)" }}>
            <button className="btn btn-ghost" disabled={busy} onClick={cancel}>
              취소
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={save}>
              {busy ? "저장하는 중…" : "저장하기"}
            </button>
          </div>
        </div>
      ) : s ? (
        <div className="panel">
          <SubmissionSummary data={s} />
        </div>
      ) : (
        <div className="panel">
          <div className="empty">
            <strong>아직 제출하지 않은 업체입니다</strong>
            전용 링크를 다시 안내하거나, 전화·메일로 받은 내용을 ‘대신 입력하기’로 등록할 수 있습니다.
          </div>
        </div>
      )}

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h2>이 업체의 작업 이력</h2>
        </div>
        {logs == null ? (
          <Spinner />
        ) : logs.length === 0 ? (
          <p className="muted small">기록이 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>일시</th>
                  <th>작업</th>
                  <th>작업자</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(l.createdAt)}
                    </td>
                    <td>{ACTION_LABEL[l.action] ?? l.action}</td>
                    <td>{l.actor === "admin" ? "운영사무국" : "참가업체"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// 럭키드로우 관리
// ---------------------------------------------------------------------

function LuckyDraw({ ctx }: { ctx: Ctx }) {
  const dl = useDownload(ctx.notify);
  const providers = ctx.data.companies.filter((c) => c.submission?.luckyDrawProvided);
  const items = providers.flatMap((c) => c.submission!.gifts.map((g, i) => ({ c, g, i })));
  const totalQty = items.reduce((a, x) => a + x.g.quantity, 0);
  const totalAmt = items.reduce((a, x) => a + giftTotal(x.g), 0);
  const submitted = ctx.data.companies.filter((c) => c.submission).length;

  return (
    <>
      <div className="ad-top">
        <div>
          <h1>럭키드로우 관리</h1>
          <p>참가업체가 제출한 럭키드로우 경품을 모아 봅니다. 총금액은 정상 판매가 × 제공 수량 기준입니다.</p>
        </div>
        <div className="ad-actions">
          <button className="btn btn-primary btn-sm" disabled={dl.busy === "lucky-draw"} onClick={() => dl.run("lucky-draw")}>
            {dl.busy === "lucky-draw" ? "만드는 중…" : "경품 관리 엑셀"}
          </button>
          <button className="btn btn-soft btn-sm" disabled={dl.busy === "lucky-draw.pdf"} onClick={() => dl.run("lucky-draw", "pdf")}>
            {dl.busy === "lucky-draw.pdf" ? "만드는 중…" : "경품 관리 PDF"}
          </button>
        </div>
      </div>
      <div className="stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div className="stat">
          <div className="label">제공 업체</div>
          <div className="value num">
            {providers.length}
            <small>개사</small>
          </div>
          <div className="sub">제출 {submitted}개사 중</div>
        </div>
        <div className="stat">
          <div className="label">경품 종류</div>
          <div className="value num">
            {items.length}
            <small>종</small>
          </div>
        </div>
        <div className="stat accent">
          <div className="label">전체 경품 총수량</div>
          <div className="value num">
            {formatNumber(totalQty)}
            <small>개</small>
          </div>
        </div>
        <div className="stat">
          <div className="label">정상가 기준 총금액</div>
          <div className="value num" style={{ fontSize: 26 }}>
            {formatNumber(totalAmt)}
            <small>원</small>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>경품 목록</h2>
        </div>
        {items.length === 0 ? (
          <div className="empty">
            <strong>아직 제출된 럭키드로우 경품이 없습니다</strong>업체가 ‘제공함’으로 제출하면 이곳에 표시됩니다.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>제공 업체명</th>
                  <th>경품 상품명</th>
                  <th className="r">제공 수량</th>
                  <th className="r">정상 판매가(1개)</th>
                  <th className="r">총금액</th>
                </tr>
              </thead>
              <tbody>
                {items.map(({ c, g, i }) => (
                  <tr key={`${c.id}-${i}`}>
                    <td>
                      {i === 0 ? (
                        <a href={`/admin/companies/${c.id}`} style={{ fontWeight: 650, color: "var(--ink)" }}>
                          {c.submission!.companyName}
                        </a>
                      ) : (
                        <span className="muted small">〃</span>
                      )}
                    </td>
                    <td style={{ fontWeight: 600 }}>{g.name}</td>
                    <td className="r">{formatNumber(g.quantity)}개</td>
                    <td className="r">{formatWon(g.unitPrice)}</td>
                    <td className="r">{formatWon(giftTotal(g))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>전체 합계</td>
                  <td>{items.length}종</td>
                  <td className="r num">{formatNumber(totalQty)}개</td>
                  <td />
                  <td className="r num">{formatWon(totalAmt)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {providers.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2>업체별 합계</h2>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>제공 업체명</th>
                  <th className="r">경품 종류</th>
                  <th className="r">총수량</th>
                  <th className="r">총금액</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((c) => {
                  const g = submissionGiftSummary(c.submission);
                  return (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 650 }}>{c.submission!.companyName}</td>
                      <td className="r">{g.kinds}종</td>
                      <td className="r">{formatNumber(g.quantity)}개</td>
                      <td className="r">{formatWon(g.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// 엑셀 다운로드
// ---------------------------------------------------------------------

function Downloads({ ctx }: { ctx: Ctx }) {
  const dl = useDownload(ctx.notify);
  const cards: Array<[string, string, string]> = [
    ["all", "전체 참가업체 제출 정보", "업체별 제출 현황, 대표 판매상품, 럭키드로우 경품을 시트(쪽)별로 나눠 담습니다. 미제출 업체도 포함됩니다."],
    ["price-board", "가격 안내판 제작용 데이터", "제출 업체의 상품명·정상가·할인가·할인 금액·할인율·샘플·추가 혜택을 상품 단위로 정리합니다."],
    ["lucky-draw", "럭키드로우 경품 관리 데이터", "경품별 수량·정상가·총금액과 업체별 합계, 전체 합계를 담습니다."],
    ["sales", "일자별 판매실적", "10/23·24·25 업체별 부스 방문객 수·판매 건수·금액, 합계, 10/25 만족도조사 여부와 입력 내역을 담습니다."],
    ["sales-report", "판매실적 성과 리포트", "일자별 입력률·판매 건수·금액, 상위 업체 TOP10, 미입력 업체, 산출 기준을 보고용으로 정리합니다. 주최·주관·운영 표기가 들어갑니다."],
    ["links", "업체별 제출 링크 목록", "업체명과 전용 제출 링크, 현재 제출 여부를 담습니다. 링크 일괄 안내에 사용하세요."],
  ];
  return (
    <>
      <div className="ad-top">
        <div>
          <h1>다운로드 (엑셀 · PDF)</h1>
          <p>
            내려받는 시점의 최신 데이터로 만듭니다. 엑셀은 금액·수량이 숫자 형식(천 단위 쉼표)이라 바로 계산할 수 있고, PDF는 보고·인쇄용으로 같은 내용을
            행사 디자인에 맞춰 정리합니다.
          </p>
        </div>
      </div>
      <div className="dl-grid">
        {cards.map(([type, title, desc]) => (
          <div className="dl-card" key={type}>
            <h3>{title}</h3>
            <p>{desc}</p>
            <div className="dl-actions">
              <button className="btn btn-primary btn-sm" disabled={dl.busy !== null} onClick={() => dl.run(type)}>
                {dl.busy === type ? "만드는 중…" : "엑셀 내려받기"}
              </button>
              <button className="btn btn-soft btn-sm" disabled={dl.busy !== null} onClick={() => dl.run(type, "pdf")}>
                {dl.busy === `${type}.pdf` ? "만드는 중…" : "PDF 내려받기"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// 판매실적
// ---------------------------------------------------------------------

function SalesAdmin({ ctx }: { ctx: Ctx }) {
  const dl = useDownload(ctx.notify);
  const [rows, setRows] = useState<SalesEntry[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      setRows(await api<SalesEntry[]>("/api/admin/sales"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "판매실적을 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30000);
    return () => clearInterval(t);
  }, [load]);

  const by = useMemo(() => {
    const m = new Map<string, SalesEntry>();
    for (const e of rows ?? []) if (e.companyId) m.set(`${e.companyId}|${e.day}`, e);
    return m;
  }, [rows]);

  const stats = useMemo(() => computeSalesStats(ctx.data.companies, rows ?? []), [ctx.data.companies, rows]);
  const companies = ctx.data.companies.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const totals = EVENT_DAYS.map((d) => {
    let visitors = 0;
    let items = 0;
    let amount = 0;
    let n = 0;
    for (const c of ctx.data.companies) {
      const e = by.get(`${c.id}|${d.date}`);
      if (e) {
        visitors += e.visitors ?? 0;
        items += e.items;
        amount += e.amount;
        n++;
      }
    }
    return { visitors, items, amount, n };
  });
  const gVisitors = totals.reduce((a, t) => a + t.visitors, 0);
  const gItems = totals.reduce((a, t) => a + t.items, 0);
  const gAmount = totals.reduce((a, t) => a + t.amount, 0);
  const lastDay = EVENT_DAYS[EVENT_DAYS.length - 1].date;
  const surveyDone = ctx.data.companies.filter((c) => by.get(`${c.id}|${lastDay}`)?.surveyDone).length;

  return (
    <>
      <div className="ad-top">
        <div>
          <h1>판매실적</h1>
          <p>업체가 행사일(10/23·24·25)별로 제출한 부스 방문객 수, 판매 건수와 금액입니다. 30초마다 자동으로 새로 불러옵니다.</p>
        </div>
        <div className="dl-actions">
          <button className="btn btn-primary btn-sm" disabled={dl.busy !== null} onClick={() => dl.run("sales")}>
            {dl.busy === "sales" ? "만드는 중…" : "엑셀 내려받기"}
          </button>
          <button className="btn btn-soft btn-sm" disabled={dl.busy !== null} onClick={() => dl.run("sales", "pdf")}>
            {dl.busy === "sales.pdf" ? "만드는 중…" : "PDF 내려받기"}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={dl.busy !== null} onClick={() => dl.run("sales-report", "pdf")}>
            {dl.busy === "sales-report.pdf" ? "만드는 중…" : "성과 리포트 PDF"}
          </button>
        </div>
      </div>

      {error && <div className="notice notice-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!rows && !error && <Spinner />}

      {rows && (
        <>
          <div className="sales-kpis">
            <div className="sales-kpi">
              <div className="k">총 부스 방문객</div>
              <div className="v">{formatNumber(gVisitors)}명</div>
            </div>
            <div className="sales-kpi">
              <div className="k">총 판매 건수</div>
              <div className="v">{formatNumber(gItems)}건</div>
            </div>
            <div className="sales-kpi">
              <div className="k">총 판매금액</div>
              <div className="v">{formatWon(gAmount)}</div>
            </div>
            {EVENT_DAYS.map((d, i) => (
              <div className="sales-kpi" key={d.date}>
                <div className="k">
                  {d.short} 입력 업체
                </div>
                <div className="v">
                  {totals[i].n} / {ctx.data.companies.length}
                </div>
              </div>
            ))}
            <div className="sales-kpi">
              <div className="k">10/25 만족도조사 완료</div>
              <div className="v">
                {surveyDone} / {ctx.data.companies.length}
              </div>
            </div>
          </div>

          <SalesProgress stats={stats} loaded error="" notify={ctx.notify} />

          <div className="panel">
            <div className="panel-head">
              <h2>업체별 · 일자별 판매실적</h2>
              <input className="input" style={{ maxWidth: 240, minHeight: 40, padding: "8px 14px", fontSize: 15 }} placeholder="업체명 검색" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="table-wrap">
              <table className="data-table sales-admin">
                <thead>
                  <tr>
                    <th rowSpan={2}>업체명</th>
                    {EVENT_DAYS.map((d) => (
                      <th key={d.date} colSpan={3} className="c day-sep">
                        {d.label} ({d.weekday})
                      </th>
                    ))}
                    <th colSpan={3} className="c day-sep">
                      합계
                    </th>
                    <th rowSpan={2} className="c">
                      10/25 만족도조사
                    </th>
                  </tr>
                  <tr>
                    {[...EVENT_DAYS, null].flatMap((d, i) => [
                      <th key={`v${i}`} className="r day-sep">
                        방문객
                      </th>,
                      <th key={`a${i}`} className="r">
                        건수
                      </th>,
                      <th key={`b${i}`} className="r">
                        금액(원)
                      </th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => {
                    let tv = 0;
                    let ti = 0;
                    let ta = 0;
                    const cells = EVENT_DAYS.flatMap((d) => {
                      const e = by.get(`${c.id}|${d.date}`);
                      if (e) {
                        tv += e.visitors ?? 0;
                        ti += e.items;
                        ta += e.amount;
                      }
                      return [
                        <td key={`${d.date}v`} className="r num day-sep">
                          {e ? e.visitors !== null && e.visitors !== undefined ? formatNumber(e.visitors) : <span className="muted">-</span> : <span className="muted">미입력</span>}
                        </td>,
                        <td key={`${d.date}i`} className="r num">
                          {e ? formatNumber(e.items) : <span className="muted">미입력</span>}
                        </td>,
                        <td key={`${d.date}a`} className="r num">
                          {e ? formatNumber(e.amount) : <span className="muted">미입력</span>}
                        </td>,
                      ];
                    });
                    const last = by.get(`${c.id}|${lastDay}`);
                    const any = EVENT_DAYS.some((d) => by.has(`${c.id}|${d.date}`));
                    return (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        {cells}
                        <td className="r num day-sep">
                          {any ? <strong>{formatNumber(tv)}</strong> : <span className="muted">미입력</span>}
                        </td>
                        <td className="r num">
                          {any ? <strong>{formatNumber(ti)}</strong> : <span className="muted">미입력</span>}
                        </td>
                        <td className="r num">
                          {any ? <strong>{formatNumber(ta)}</strong> : <span className="muted">미입력</span>}
                        </td>
                        <td className="c">
                          {last ? last.surveyDone ? <span className="status done">완료</span> : <span className="status todo">미완료</span> : <span className="muted">미입력</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {companies.length === 0 && (
                    <tr>
                      <td colSpan={13} className="muted" style={{ textAlign: "center" }}>
                        조건에 맞는 업체가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td>전체 합계</td>
                    {totals.flatMap((t, i) => [
                      <td key={`tv${i}`} className="r num day-sep">
                        {formatNumber(t.visitors)}
                      </td>,
                      <td key={`ti${i}`} className="r num">
                        {formatNumber(t.items)}
                      </td>,
                      <td key={`ta${i}`} className="r num">
                        {formatNumber(t.amount)}
                      </td>,
                    ])}
                    <td className="r num day-sep">{formatNumber(gVisitors)}</td>
                    <td className="r num">{formatNumber(gItems)}</td>
                    <td className="r num">{formatNumber(gAmount)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// 작업 이력
// ---------------------------------------------------------------------

function describe(l: AuditLog): string {
  const d = l.detail as Record<string, unknown>;
  if (l.action === "settings_updated") return d.submissionOpen ? "제출 접수 열기" : "제출 접수 마감";
  if (l.action === "company_updated") {
    const parts: string[] = [];
    const name = d.name as { from: string; to: string } | undefined;
    if (name) parts.push(`이름: ${name.from} → ${name.to}`);
    if (typeof d.isLocked === "boolean") parts.push(d.isLocked ? "수정 잠금" : "잠금 해제");
    return parts.join(", ");
  }
  if (l.action === "sales_created" || l.action === "sales_updated") {
    const day = typeof d.day === "string" ? d.day.slice(5).replace("-", "/") : "";
    return `${day} · ${d.visitors !== undefined && d.visitors !== null ? `방문객 ${formatNumber(Number(d.visitors))}명 · ` : ""}${formatNumber(Number(d.items ?? 0))}건 / ${formatNumber(Number(d.amount ?? 0))}원${d.surveyDone ? " · 만족도조사 완료" : ""}`;
  }
  if (l.action === "submission_created" || l.action === "submission_updated") {
    const after = d.after as Submission | undefined;
    if (!after) return "";
    const g = submissionGiftSummary(after);
    return `상품 ${after.products.length}개 · 럭키드로우 ${after.luckyDrawProvided ? `${formatNumber(g.quantity)}개` : "미제공"}`;
  }
  return "";
}

function Logs({ ctx }: { ctx: Ctx }) {
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<AuditLog[]>("/api/admin/logs")
      .then(setLogs)
      .catch((e) => setError(e instanceof Error ? e.message : "불러오지 못했습니다."));
  }, [ctx.data]);
  return (
    <>
      <div className="ad-top">
        <div>
          <h1>작업 이력</h1>
          <p>제출·수정·삭제와 업체 관리 작업이 최근 순으로 기록됩니다. (최근 500건)</p>
        </div>
      </div>
      <div className="panel">
        {error && <div className="notice notice-error">{error}</div>}
        {!logs && !error && <Spinner />}
        {logs && logs.length === 0 && <div className="empty">기록이 없습니다.</div>}
        {logs && logs.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>일시</th>
                  <th>업체</th>
                  <th>작업</th>
                  <th>작업자</th>
                  <th>내용</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(l.createdAt)}
                    </td>
                    <td>
                      {l.companyId && ctx.data.companies.some((c) => c.id === l.companyId) ? (
                        <a href={`/admin/companies/${l.companyId}`}>{l.companyName}</a>
                      ) : (
                        (l.companyName ?? <span className="muted">전체</span>)
                      )}
                    </td>
                    <td>{ACTION_LABEL[l.action] ?? l.action}</td>
                    <td>{l.actor === "admin" ? "운영사무국" : "참가업체"}</td>
                    <td className="log-detail">{describe(l)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
