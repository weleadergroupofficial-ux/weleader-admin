"use client";

/** 업체 전용 화면 위쪽 탭: 참가정보 제출 ↔ 판매실적 입력 */
export function CompanyTabs({ token, active }: { token: string; active: "info" | "sales" }) {
  const t = encodeURIComponent(token);
  return (
    <nav className="co-tabs" aria-label="업체 전용 메뉴">
      <a href={`/s/${t}`} className={active === "info" ? "on" : ""} aria-current={active === "info" ? "page" : undefined}>
        참가정보 제출
      </a>
      <a href={`/s/${t}/sales`} className={active === "sales" ? "on" : ""} aria-current={active === "sales" ? "page" : undefined}>
        판매실적 입력
      </a>
    </nav>
  );
}
