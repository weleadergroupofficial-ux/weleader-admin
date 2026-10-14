"use client";

import type { FieldErrors } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public fieldErrors?: FieldErrors,
  ) {
    super(message);
  }
}

/** 브라우저 → 우리 서버 API 호출 (DB 키는 서버에만 있음) */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError("인터넷 연결을 확인한 뒤 다시 시도해 주세요.", 0);
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const message = typeof body.error === "string" ? body.error : `요청을 처리하지 못했습니다. (오류 ${res.status})`;
    throw new ApiError(message, res.status, body.code as string | undefined, body.fieldErrors as FieldErrors | undefined);
  }
  return body as T;
}

/**
 * 페이지 이동. 실제 배포에서는 일반 이동이며, 데모 환경에서는 window.__BW_HOST__ 가 대신 처리합니다.
 */
type Host = {
  navigate?: (path: string) => void;
  replaceUrl?: (path: string) => void;
  save?: (filename: string, blob: Blob) => Promise<void>;
};
const host = (): Host => (typeof window !== "undefined" ? ((window as unknown as { __BW_HOST__?: Host }).__BW_HOST__ ?? {}) : {});

export function navigate(path: string) {
  const h = host();
  if (h.navigate) h.navigate(path);
  else window.location.href = path;
}

export function replaceUrl(path: string) {
  const h = host();
  if (h.replaceUrl) h.replaceUrl(path);
  else history.replaceState(null, "", path);
}

export async function downloadFile(path: string) {
  const res = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) {
    let msg = `다운로드에 실패했습니다. (오류 ${res.status})`;
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status);
  }
  const cd = res.headers.get("Content-Disposition") ?? "";
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : "download.xlsx";
  const blob = await res.blob();
  const h = host();
  if (h.save) {
    await h.save(name, blob);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 첫 번째 오류 입력란으로 스크롤 */
export function focusFirstError() {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(".field.invalid [data-field], .field-error");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (el.matches("input, textarea")) (el as HTMLInputElement).focus({ preventScroll: true });
  });
}
