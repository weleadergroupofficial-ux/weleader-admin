/**
 * 관리자 세션 — HMAC 서명 쿠키.
 * Web Crypto 만 사용하므로 Next.js 미들웨어(Edge)와 API(Node) 양쪽에서 동작합니다.
 * ADMIN_PASSWORD 를 바꾸면 기존 세션은 모두 무효가 됩니다.
 */

export const SESSION_COOKIE = "bw_admin";
export const SESSION_HOURS = 12;

const enc = new TextEncoder();

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function authConfig(): { password: string; secret: string } | null {
  const password = process.env.ADMIN_PASSWORD ?? "";
  const secret = process.env.SESSION_SECRET ?? "";
  if (password.length < 6 || secret.length < 32) return null;
  return { password, secret };
}

export async function checkPassword(input: string): Promise<boolean> {
  const cfg = authConfig();
  if (!cfg) return false;
  // 해시끼리 비교 → 길이 정보 노출 없이 일정 시간 비교
  return safeEqual(await sha256(input), await sha256(cfg.password));
}

export async function createSessionToken(): Promise<string> {
  const cfg = authConfig();
  if (!cfg) throw new Error("auth not configured");
  const exp = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600;
  const fp = (await sha256(cfg.password)).slice(0, 16);
  const sig = await hmac(cfg.secret, `admin.${exp}.${fp}`);
  return `${exp}.${sig}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const cfg = authConfig();
  if (!cfg) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || !sig || exp < Math.floor(Date.now() / 1000)) return false;
  const fp = (await sha256(cfg.password)).slice(0, 16);
  const expected = await hmac(cfg.secret, `admin.${exp}.${fp}`);
  return safeEqual(sig, expected);
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function sessionCookieHeader(value: string, secure: boolean, maxAgeSec = SESSION_HOURS * 3600): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
