"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, focusFirstError } from "@/lib/client";
import { formatDateTime } from "@/lib/calc";
import type { FieldErrors, PublicSubmitState, Submission, SubmissionDraft, SubmissionInput } from "@/lib/types";
import { draftFromSubmission, draftToPayload, validateSubmission } from "@/lib/validation";
import { SubmissionEditor } from "../SubmissionEditor";
import { SubmissionSummary } from "../SubmissionSummary";
import { Spinner, Wordmark } from "../ui/fields";

type Phase = "loading" | "invalid" | "failed" | "form" | "preview" | "done" | "readonly";

const DONE_MESSAGE = "참가업체 정보가 정상적으로 제출되었습니다. 협조해 주셔서 감사합니다.";

export default function SubmitApp({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [state, setState] = useState<PublicSubmitState | null>(null);
  const [draft, setDraft] = useState<SubmissionDraft | null>(null);
  const [checked, setChecked] = useState<SubmissionInput | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "warn"; text: string; reload?: boolean } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    setMessage(null);
    try {
      const s = await api<PublicSubmitState>(`/api/submit/${encodeURIComponent(token)}`);
      setState(s);
      setDraft(draftFromSubmission(s.submission, s.company.name));
      setErrors({});
      setTriedSubmit(false);
      setDirty(false);
      setPhase(s.company.isLocked || !s.submissionOpen ? "readonly" : "form");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setPhase("invalid");
      else {
        setLoadError(e instanceof Error ? e.message : "정보를 불러오지 못했습니다.");
        setPhase("failed");
      }
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // 저장하지 않은 입력이 있을 때 페이지를 벗어나면 확인
  useEffect(() => {
    if (!dirty || (phase !== "form" && phase !== "preview")) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [phase, dirty]);

  function update(next: SubmissionDraft) {
    setDraft(next);
    setDirty(true);
    if (triedSubmit) {
      const v = validateSubmission(draftToPayload(next));
      setErrors(v.ok ? {} : v.errors);
    }
  }

  function goPreview() {
    if (!draft) return;
    setTriedSubmit(true);
    const v = validateSubmission(draftToPayload(draft));
    if (!v.ok) {
      setErrors(v.errors);
      setMessage({ kind: "error", text: `입력하지 않았거나 확인이 필요한 항목이 ${Object.keys(v.errors).length}개 있습니다.` });
      focusFirstError();
      return;
    }
    setErrors({});
    setMessage(null);
    setChecked(v.value);
    setPhase("preview");
    window.scrollTo({ top: 0 });
  }

  async function submit() {
    if (!checked || !state) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ submission: Submission }>(`/api/submit/${encodeURIComponent(token)}`, {
        method: "POST",
        json: { expectedRevision: state.submission?.revision ?? null, data: checked },
      });
      setState({ ...state, submission: res.submission });
      setDraft(draftFromSubmission(res.submission, state.company.name));
      setDirty(false);
      setPhase("done");
      window.scrollTo({ top: 0 });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("제출하지 못했습니다. 잠시 후 다시 시도해 주세요.", 0);
      if (err.fieldErrors) {
        setErrors(err.fieldErrors);
        setPhase("form");
        setMessage({ kind: "error", text: err.message });
        focusFirstError();
      } else if (err.status === 423) {
        setMessage({ kind: "warn", text: err.message, reload: true });
      } else if (err.status === 409) {
        setMessage({ kind: "warn", text: err.message, reload: true });
      } else {
        setMessage({ kind: "error", text: `${err.message} 입력한 내용은 이 화면에 그대로 남아 있습니다.` });
      }
    } finally {
      setBusy(false);
    }
  }

  const step = phase === "preview" ? 2 : phase === "done" ? 3 : 1;
  const companyName = state?.company.name;

  return (
    <div className="sb-page">
      <div className="sb-container">
        <header className="sb-masthead">
          <Wordmark />
          <h1 className="sb-title">
            참가업체 부스 운영 및
            <br />
            럭키드로우 정보 제출
          </h1>
          {companyName && (
            <div className="company-chip">
              <span className="badge">전용 링크</span>
              {companyName}
            </div>
          )}
        </header>

        {phase === "loading" && (
          <div className="state-screen">
            <Spinner label="제출 정보를 불러오는 중입니다" />
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

        {(phase === "form" || phase === "preview" || phase === "readonly") && (
          <>
            {phase !== "readonly" && (
              <div className="intro">
                <p>안녕하세요. BEAUTY WAVE in INCHEON 2026 운영사무국입니다.</p>
                <p>
                  원활한 행사 준비를 위해 참가업체별 대표 판매상품 및 행사 특별 혜택, 럭키드로우 제공 상품에 대한 정보를 취합하고
                  있습니다.
                </p>
                <p>
                  제출해 주신 내용은 <span className="emph">행사장 내 상품 가격 안내판 제작</span> 및{" "}
                  <span className="emph">럭키드로우 이벤트 운영</span>에 활용될 예정입니다. 정확한 정보로 작성해 주시기 바랍니다.
                </p>
              </div>
            )}

            {phase !== "readonly" && (
              <ol className="stepper" aria-label="진행 단계">
                <li className={step >= 1 ? "on" : ""} aria-current={step === 1 ? "step" : undefined}>
                  1. 정보 입력
                </li>
                <li className={step >= 2 ? "on" : ""} aria-current={step === 2 ? "step" : undefined}>
                  2. 제출 전 확인
                </li>
                <li className={step >= 3 ? "on" : ""}>3. 제출 완료</li>
              </ol>
            )}

            {state?.submission && phase === "form" && (
              <div className="notice notice-info" style={{ marginTop: 4 }}>
                <strong>이미 제출된 정보가 있습니다</strong>
                최종 제출 {formatDateTime(state.submission.updatedAt)} · 내용을 고친 뒤 다시 제출하면 최신 내용으로 바뀝니다.
              </div>
            )}
          </>
        )}

        {phase === "readonly" && state && (
          <>
            <div className="notice notice-warn" style={{ marginTop: 8 }}>
              <strong>{!state.submissionOpen ? "제출 기간이 마감되었습니다" : "제출 내용이 확정되었습니다"}</strong>
              {state.submission
                ? "아래는 제출하신 내용입니다. 변경이 필요하면 운영사무국으로 연락해 주세요."
                : "변경이나 추가 제출이 필요하면 운영사무국으로 연락해 주세요."}
            </div>
            {state.submission && (
              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">제출한 내용</h2>
                  <p className="section-desc">최종 제출 {formatDateTime(state.submission.updatedAt)}</p>
                </div>
                <SubmissionSummary data={state.submission} />
              </section>
            )}
          </>
        )}

        {phase === "form" && draft && (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              goPreview();
            }}
          >
            <SubmissionEditor value={draft} onChange={update} errors={errors} />
            {message && (
              <div className={`notice notice-${message.kind}`} role="alert" style={{ marginTop: 20 }}>
                {message.text}
              </div>
            )}
            <div className="action-bar">
              <button type="submit" className="btn btn-primary btn-lg">
                입력 내용 확인하기
              </button>
            </div>
          </form>
        )}

        {phase === "preview" && checked && (
          <>
            <section className="section" aria-labelledby="sec4">
              <div className="section-head">
                <div className="section-no">SECTION 04</div>
                <h2 className="section-title" id="sec4">
                  제출 전 확인
                </h2>
                <p className="section-desc">아래 내용으로 제출됩니다. 가격과 수량을 한 번 더 확인해 주세요.</p>
              </div>
              <SubmissionSummary data={checked} />
            </section>
            {message && (
              <div className={`notice notice-${message.kind}`} role="alert" style={{ marginTop: 20 }}>
                {message.text}
                {message.reload && (
                  <div style={{ marginTop: 10 }}>
                    <button className="btn btn-ghost btn-sm" onClick={load}>
                      최신 내용 불러오기
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="action-bar">
              <button
                className="btn btn-ghost btn-lg"
                disabled={busy}
                onClick={() => {
                  setPhase("form");
                  setMessage(null);
                  window.scrollTo({ top: 0 });
                }}
              >
                이전 단계
              </button>
              <button className="btn btn-primary btn-lg" disabled={busy} onClick={submit}>
                {busy ? "제출하는 중…" : state?.submission ? "수정 내용 제출하기" : "최종 제출하기"}
              </button>
            </div>
          </>
        )}

        {phase === "done" && state?.submission && (
          <>
            <section className="section done" aria-live="polite">
              <div className="done-mark" aria-hidden="true">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </div>
              <h2>제출이 완료되었습니다</h2>
              <p>{DONE_MESSAGE}</p>
              <div className="sig">BEAUTY WAVE in INCHEON 2026 운영사무국</div>
              <p className="small muted" style={{ marginTop: 18 }}>
                접수 {formatDateTime(state.submission.updatedAt)} · 같은 링크로 다시 접속해 언제든 수정할 수 있습니다.
              </p>
              <div style={{ marginTop: 24, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setPhase("form");
                    setTriedSubmit(false);
                    window.scrollTo({ top: 0 });
                  }}
                >
                  제출 내용 수정하기
                </button>
              </div>
            </section>
            <section className="section">
              <div className="section-head">
                <h2 className="section-title">제출한 내용</h2>
              </div>
              <SubmissionSummary data={state.submission} showSigns={false} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
