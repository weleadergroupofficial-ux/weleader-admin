"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { formatDateTime, formatNumber } from "@/lib/calc";
import { EVENT_DAYS, MAX_SALES_AMOUNT, MAX_SALES_ITEMS, MAX_VISITORS, todayKst, type SalesEntry, type SalesState } from "@/lib/event";
import { Spinner, Wordmark } from "../ui/fields";
import { CompanyTabs } from "./CompanyTabs";

type Phase = "loading" | "invalid" | "failed" | "ready";

/** 숫자만 남기고 천 단위 쉼표를 보여주는 입력값 */
function digits(v: string, max: number): string {
  const d = v.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!d) return "";
  return Number(d) > max ? String(max) : d;
}
const show = (d: string) => (d === "" ? "" : formatNumber(Number(d)));

/** /s/demo/sales : 로그인 없이 화면을 확인하는 미리보기 (서버에 저장하지 않음) */
const DEMO_TOKEN = "demo";

export default function SalesApp({ token }: { token: string }) {
  const demo = token === DEMO_TOKEN;
  const [phase, setPhase] = useState<Phase>("loading");
  const [state, setState] = useState<SalesState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [day, setDay] = useState(EVENT_DAYS[0].date);
  const [items, setItems] = useState("");
  const [amount, setAmount] = useState("");
  const [visitors, setVisitors] = useState("");
  const [surveyOpened, setSurveyOpened] = useState(false);
  const [surveyChecked, setSurveyChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok" | "warn"; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const entryOf = useCallback((s: SalesState | null, d: string): SalesEntry | undefined => s?.entries.find((e) => e.day === d), []);

  const fillFrom = useCallback(
    (s: SalesState | null, d: string) => {
      const e = entryOf(s, d);
      setItems(e ? String(e.items) : "");
      setAmount(e ? String(e.amount) : "");
      setVisitors(e && e.visitors !== null && e.visitors !== undefined ? String(e.visitors) : "");
      setSurveyOpened(!!e?.surveyDone);
      setSurveyChecked(!!e?.surveyDone);
      setErrors({});
      setMessage(null);
    },
    [entryOf],
  );

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const s: SalesState = demo
        ? { company: { name: "테스트 업체 (미리보기)" }, entries: [], surveyUrl: "https://forms.gle/2v9VWcqW82pRf4mX7" }
        : await api<SalesState>(`/api/sales/${encodeURIComponent(token)}`);
      setState(s);
      // 행사 기간이면 오늘 날짜 탭을, 아니면 첫날 탭을 먼저 보여줍니다.
      const today = todayKst();
      const start = EVENT_DAYS.find((d) => d.date === today)?.date ?? (today > EVENT_DAYS[EVENT_DAYS.length - 1].date ? EVENT_DAYS[EVENT_DAYS.length - 1].date : EVENT_DAYS[0].date);
      setDay(start);
      fillFrom(s, start);
      setPhase("ready");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setPhase("invalid");
      else {
        setLoadError(e instanceof Error ? e.message : "정보를 불러오지 못했습니다.");
        setPhase("failed");
      }
    }
  }, [token, fillFrom, demo]);

  useEffect(() => {
    load();
  }, [load]);

  const cur = EVENT_DAYS.find((d) => d.date === day)!;
  const saved = entryOf(state, day);
  const surveyAlready = !!saved?.surveyDone;
  const needSurvey = cur.last && !surveyAlready;

  const dirty = useMemo(() => {
    if (!saved) return items !== "" || amount !== "" || visitors !== "";
    return String(saved.items) !== items || String(saved.amount) !== amount || String(saved.visitors ?? "") !== visitors;
  }, [saved, items, amount, visitors]);

  const canSubmit = visitors !== "" && items !== "" && amount !== "" && (!needSurvey || (surveyOpened && surveyChecked)) && !busy;

  function pickDay(d: string) {
    if (d === day) return;
    if (dirty && !window.confirm("저장하지 않은 입력이 있습니다. 다른 날짜로 이동할까요?")) return;
    setDay(d);
    fillFrom(state, d);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!state) return;
    const errs: Record<string, string> = {};
    if (visitors === "") errs.visitors = "부스 방문객 수를 입력해 주세요. 방문객이 없었다면 0을 입력해 주세요.";
    if (items === "") errs.items = "판매 상품 건수를 입력해 주세요. 판매가 없었다면 0을 입력해 주세요.";
    if (amount === "") errs.amount = "총 판매금액을 입력해 주세요. 판매가 없었다면 0을 입력해 주세요.";
    if (needSurvey && !(surveyOpened && surveyChecked)) errs.survey = "만족도조사를 완료한 뒤에 제출할 수 있습니다.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    setMessage(null);
    try {
      const body = { visitors: Number(visitors), items: Number(items), amount: Number(amount), surveyDone: cur.last ? surveyChecked || surveyAlready : false };
      const now = new Date().toISOString();
      const r: { entry: SalesEntry } = demo
        ? { entry: { day, ...body, revision: (saved?.revision ?? 0) + 1, firstSubmittedAt: saved?.firstSubmittedAt ?? now, updatedAt: now } }
        : await api<{ entry: SalesEntry }>(`/api/sales/${encodeURIComponent(token)}/${day}`, { method: "PUT", json: body });
      const next: SalesState = { ...state, entries: [...state.entries.filter((x) => x.day !== day), r.entry].sort((a, b) => a.day.localeCompare(b.day)) };
      setState(next);
      setSurveyChecked(r.entry.surveyDone);
      setMessage({ kind: "ok", text: `${cur.label} 판매실적이 제출되었습니다. 숫자를 고치려면 다시 입력해 제출하면 최신 내용으로 바뀝니다.` });
    } catch (err) {
      const e2 = err instanceof ApiError ? err : new ApiError("제출하지 못했습니다. 잠시 후 다시 시도해 주세요.", 0);
      if (e2.fieldErrors) setErrors(e2.fieldErrors);
      setMessage({ kind: "error", text: `${e2.message} 입력한 내용은 이 화면에 그대로 남아 있습니다.` });
    } finally {
      setBusy(false);
    }
  }

  const total = useMemo(() => {
    const e = state?.entries ?? [];
    return { visitors: e.reduce((a, x) => a + (x.visitors ?? 0), 0), items: e.reduce((a, x) => a + x.items, 0), amount: e.reduce((a, x) => a + x.amount, 0), days: e.length };
  }, [state]);

  return (
    <div className="sb-page">
      <div className="sb-container">
        <header className="sb-masthead">
          <Wordmark />
          <h1 className="sb-title">
            행사 기간 판매실적 입력
          </h1>
          {state && (
            <div className="company-chip">
              <span className="badge">전용 링크</span>
              {state.company.name}
            </div>
          )}
        </header>

        {phase === "loading" && (
          <div className="state-screen">
            <Spinner label="판매실적을 불러오는 중입니다" />
          </div>
        )}
        {phase === "invalid" && (
          <div className="state-screen">
            <div>
              <h2>유효하지 않은 링크입니다</h2>
              <p>링크 주소가 잘렸거나 재발급되었을 수 있습니다. 운영사무국에서 받은 최신 링크로 다시 접속해 주세요.</p>
            </div>
          </div>
        )}
        {phase === "failed" && (
          <div className="state-screen">
            <div>
              <h2>정보를 불러오지 못했습니다</h2>
              <p>{loadError}</p>
              <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={load}>
                다시 불러오기
              </button>
            </div>
          </div>
        )}

        {phase === "ready" && state && (
          <>
            {demo ? (
              <div className="notice notice-warn" style={{ marginBottom: 16 }}>
                테스트용 미리보기 화면입니다. 입력·제출은 이 화면에서만 확인되며 실제로 저장되지 않습니다. 새로고침하면 초기화됩니다.
              </div>
            ) : (
              <CompanyTabs token={token} active="sales" />
            )}

            <div className="intro">
              <p>
                행사 <span className="emph">일자별로 부스 방문객 수, 판매 상품 건수, 총 판매금액</span>을 입력해 주세요. 제출한 뒤에도 같은 화면에서 숫자를 고쳐 다시 제출할 수
                있습니다.
              </p>
              <p>
                마지막 날(<span className="emph">10월 25일</span>)은 <span className="emph">만족도조사</span>를 마친 뒤에 제출할 수 있습니다.
              </p>
            </div>

            <div className="day-tabs" role="tablist" aria-label="행사 일자">
              {EVENT_DAYS.map((d) => {
                const e = entryOf(state, d.date);
                const noVisitors = !!e && (e.visitors === null || e.visitors === undefined);
                const done = !!e && !noVisitors && (!d.last || e.surveyDone);
                return (
                  <button
                    key={d.date}
                    type="button"
                    role="tab"
                    aria-selected={d.date === day}
                    className={`day-tab${d.date === day ? " on" : ""}${done ? " done" : ""}`}
                    onClick={() => pickDay(d.date)}
                  >
                    <span className="d">{d.short}</span>
                    <span className="w">{d.weekday}요일</span>
                    <span className="st">{done ? "제출 완료" : noVisitors ? "방문객 입력 필요" : e ? "설문 필요" : "미입력"}</span>
                  </button>
                );
              })}
            </div>

            <form className="section sales-form" onSubmit={submit} noValidate>
              <div className="section-head">
                <h2 className="section-title">
                  {cur.label} ({cur.weekday}) 판매실적
                </h2>
                <p className="section-desc">
                  {saved ? `최종 제출 ${formatDateTime(saved.updatedAt)} · 아래 숫자를 고쳐 다시 제출할 수 있습니다.` : "이 날의 방문객 수와 판매 내용을 입력해 주세요. 없었다면 0을 입력합니다."}
                </p>
              </div>

              <div className="item-grid">
                <div className={`field${errors.visitors ? " invalid" : ""}`}>
                  <label className="field-label" htmlFor="sales-visitors">
                    <span className="q">1</span>
                    <span>부스 방문객 수 (명)</span>
                  </label>
                  <div className="input-wrap">
                    <input
                      id="sales-visitors"
                      className="input has-suffix num"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="예) 120"
                      value={show(visitors)}
                      onChange={(e) => {
                        setVisitors(digits(e.target.value, MAX_VISITORS));
                        setMessage(null);
                        setErrors((x) => ({ ...x, visitors: "" }));
                      }}
                      data-field
                    />
                    <span className="input-suffix">명</span>
                  </div>
                  <p className="field-hint">이 날 부스를 찾은 방문객 수를 대략적으로 입력해 주세요.</p>
                  {errors.visitors && <p className="field-error">{errors.visitors}</p>}
                </div>

                <div className={`field${errors.items ? " invalid" : ""}`}>
                  <label className="field-label" htmlFor="sales-items">
                    <span className="q">2</span>
                    <span>판매 상품 (건)</span>
                  </label>
                  <div className="input-wrap">
                    <input
                      id="sales-items"
                      className="input has-suffix num"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="예) 25"
                      value={show(items)}
                      onChange={(e) => {
                        setItems(digits(e.target.value, MAX_SALES_ITEMS));
                        setMessage(null);
                        setErrors((x) => ({ ...x, items: "" }));
                      }}
                      data-field
                    />
                    <span className="input-suffix">건</span>
                  </div>
                  {errors.items && <p className="field-error">{errors.items}</p>}
                </div>

                <div className={`field${errors.amount ? " invalid" : ""}`}>
                  <label className="field-label" htmlFor="sales-amount">
                    <span className="q">3</span>
                    <span>총 판매금액 (원)</span>
                  </label>
                  <div className="input-wrap">
                    <input
                      id="sales-amount"
                      className="input has-suffix num"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="예) 1,250,000"
                      value={show(amount)}
                      onChange={(e) => {
                        setAmount(digits(e.target.value, MAX_SALES_AMOUNT));
                        setMessage(null);
                        setErrors((x) => ({ ...x, amount: "" }));
                      }}
                      data-field
                    />
                    <span className="input-suffix">원</span>
                  </div>
                  {errors.amount && <p className="field-error">{errors.amount}</p>}
                </div>
              </div>

              {cur.last && (
                <div className={`survey-box${surveyAlready ? " done" : ""}${errors.survey ? " invalid" : ""}`}>
                  <div className="survey-head">
                    <span className="badge">행사 마지막 날 필수</span>
                    <strong>만족도조사</strong>
                  </div>
                  {surveyAlready ? (
                    <p className="survey-ok">만족도조사를 완료하셨습니다. 감사합니다.</p>
                  ) : (
                    <>
                      <p>제출하기 전에 아래 버튼으로 만족도조사에 참여해 주세요. 참여를 마치고 돌아와 확인란을 체크하면 제출할 수 있습니다.</p>
                      <a className="btn btn-soft" href={state.surveyUrl} target="_blank" rel="noopener noreferrer" onClick={() => setSurveyOpened(true)}>
                        만족도조사 하러 가기 (새 창)
                      </a>
                      <label className={`survey-check${surveyOpened ? "" : " disabled"}`}>
                        <input
                          type="checkbox"
                          checked={surveyChecked}
                          disabled={!surveyOpened}
                          onChange={(e) => {
                            setSurveyChecked(e.target.checked);
                            setErrors((x) => ({ ...x, survey: "" }));
                          }}
                        />
                        <span>만족도조사를 마쳤습니다</span>
                      </label>
                      {!surveyOpened && <p className="field-hint">먼저 위 버튼으로 만족도조사를 열어 주세요.</p>}
                      {errors.survey && <p className="field-error">{errors.survey}</p>}
                    </>
                  )}
                </div>
              )}

              {message && (
                <div className={`notice notice-${message.kind}`} role="alert" style={{ marginTop: 18 }}>
                  {message.text}
                </div>
              )}

              <div className="action-bar" style={{ position: "static", marginTop: 20 }}>
                <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={!canSubmit}>
                  {busy ? "제출하는 중…" : saved ? "수정하여 다시 제출하기" : "제출하기"}
                </button>
              </div>
              {needSurvey && <p className="field-hint" style={{ textAlign: "center", marginTop: 10 }}>만족도조사를 완료하면 제출 버튼이 켜집니다.</p>}
            </form>

            <section className="section sales-sum" aria-label="입력 현황">
              <div className="section-head">
                <h2 className="section-title">지금까지 제출한 내용</h2>
                <p className="section-desc">
                  {total.days}일 제출 · 합계 방문객 {formatNumber(total.visitors)}명 · {formatNumber(total.items)}건 / {formatNumber(total.amount)}원
                </p>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>일자</th>
                      <th className="r">방문객</th>
                      <th className="r">판매 건수</th>
                      <th className="r">판매금액</th>
                      <th className="c">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {EVENT_DAYS.map((d) => {
                      const e = entryOf(state, d.date);
                      return (
                        <tr key={d.date}>
                          <td>
                            {d.label} ({d.weekday})
                          </td>
                          <td className="r num">{e ? e.visitors !== null && e.visitors !== undefined ? `${formatNumber(e.visitors)}명` : <span className="muted">-</span> : <span className="muted">미입력</span>}</td>
                          <td className="r num">{e ? `${formatNumber(e.items)}건` : <span className="muted">미입력</span>}</td>
                          <td className="r num">{e ? `${formatNumber(e.amount)}원` : <span className="muted">미입력</span>}</td>
                          <td className="c">{e ? (e.visitors === null || e.visitors === undefined ? "방문객 입력 필요" : d.last && !e.surveyDone ? "설문 필요" : "제출 완료") : "미입력"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
