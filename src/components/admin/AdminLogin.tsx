"use client";

import { useState } from "react";
import { api, navigate } from "@/lib/client";
import { Wordmark } from "../ui/fields";

export default function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      setError("비밀번호를 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/login", { method: "POST", json: { password } });
      navigate("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인하지 못했습니다.");
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <Wordmark />
        <h1>웰리더 운영사무국 관리자</h1>
        <form onSubmit={submit} noValidate>
          <div className={`field${error ? " invalid" : ""}`}>
            <label className="field-label" htmlFor="pw">
              관리자 비밀번호
            </label>
            <input
              id="pw"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "pw-err" : undefined}
              autoFocus
            />
            {error && (
              <p className="field-error" id="pw-err" role="alert">
                {error}
              </p>
            )}
          </div>
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "확인 중…" : "로그인"}
          </button>
        </form>
        <p className="small muted" style={{ marginTop: 18, marginBottom: 0 }}>
          운영사무국 전용 화면입니다. 로그인 상태는 12시간 동안 유지됩니다.
        </p>
      </div>
    </div>
  );
}
