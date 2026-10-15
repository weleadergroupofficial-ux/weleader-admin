"use client";

import { useEffect, useState } from "react";
import { api, ApiError, navigate } from "@/lib/client";
import { Spinner, Wordmark } from "../ui/fields";

/** 단톡방 공용 링크: 업체명 선택 + 담당자 휴대폰 뒷자리 4자리 확인 → 업체 입력 화면 */
export default function EntryApp() {
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }> | null>(null);
  const [loadError, setLoadError] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoadError("");
    try {
      setCompanies(await api<Array<{ id: string; name: string }>>("/api/entry/companies"));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "업체 목록을 불러오지 못했습니다.");
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function submit(e: React.FormEvent, dest: "info" | "sales" = "info") {
    e.preventDefault();
    if (!companyId) return setError("업체명을 선택해 주세요.");
    if (!/^[0-9]{4}$/.test(code)) return setError("담당자 휴대폰 번호 뒷자리 숫자 4자리를 입력해 주세요.");
    setBusy(true);
    setError("");
    try {
      const r = await api<{ token: string }>("/api/entry/verify", { method: "POST", json: { companyId, code } });
      navigate(dest === "sales" ? `/s/${r.token}/sales` : `/s/${r.token}`);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "확인하지 못했습니다.");
      setBusy(false);
    }
  }

  return (
    <div className="sb-page">
      <div className="sb-container entry-wrap">
        <header className="sb-masthead">
          <Wordmark />
          <h1 className="sb-title">
            참가업체 부스 운영 및
            <br />
            럭키드로우 정보 제출
          </h1>
        </header>

        <section className="section entry-card" aria-labelledby="entry-title">
          <div className="section-head">
            <h2 className="section-title" id="entry-title">
              우리 업체 선택하기
            </h2>
            <p className="section-desc">업체명을 고르고, 신청서에 적은 담당자 휴대폰 번호 뒷자리 4자리를 입력하세요.</p>
          </div>

          {!companies && !loadError && <Spinner label="업체 목록을 불러오는 중입니다" />}
          {loadError && (
            <div className="notice notice-error" role="alert">
              {loadError}
              <div style={{ marginTop: 10 }}>
                <button className="btn btn-ghost btn-sm" onClick={load}>
                  다시 불러오기
                </button>
              </div>
            </div>
          )}

          {companies && (
            <form className="item-grid" onSubmit={(e) => submit(e, "info")} noValidate>
              <div className={`field${error && !companyId ? " invalid" : ""}`}>
                <label className="field-label" htmlFor="entry-company">
                  <span className="q">1</span>
                  <span>업체명</span>
                </label>
                <select
                  id="entry-company"
                  className="input entry-select"
                  value={companyId}
                  onChange={(e) => {
                    setCompanyId(e.target.value);
                    setError("");
                  }}
                >
                  <option value="">업체명을 선택하세요</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className={`field${error && companyId ? " invalid" : ""}`}>
                <label className="field-label" htmlFor="entry-code">
                  <span className="q">2</span>
                  <span>담당자 휴대폰 번호 뒷자리 4자리</span>
                </label>
                <input
                  id="entry-code"
                  className="input entry-code num"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  placeholder="예) 1234"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 4));
                    setError("");
                  }}
                  aria-describedby={error ? "entry-err" : undefined}
                />
              </div>

              {error && (
                <p className="field-error" id="entry-err" role="alert">
                  {error}
                </p>
              )}

              <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
                {busy ? "확인 중…" : "참가정보 입력하기"}
              </button>
              <button type="button" className="btn btn-soft btn-lg btn-block" disabled={busy} onClick={(e) => submit(e, "sales")}>
                {busy ? "확인 중…" : "행사 판매실적 입력하기 (10/23~25)"}
              </button>
              <p className="field-hint" style={{ margin: 0 }}>
                이미 제출했어도 같은 방법으로 들어와 내용을 수정할 수 있습니다.
              </p>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
