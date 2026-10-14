/**
 * Supabase 데이터베이스 함수(RPC) 호출 — 서버 전용.
 * 서비스 롤(비밀) 키는 서버 환경변수에서만 읽고, 브라우저로 절대 전달하지 않습니다.
 */

export class ConfigError extends Error {}

export class RpcError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function config() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new ConfigError("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.");
  }
  return { url: url.replace(/\/+$/, ""), key };
}

export async function rpc<T>(fn: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!/^bw_[a-z_]+$/.test(fn)) throw new Error("invalid rpc name");
  const { url, key } = config();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    apikey: key,
  };
  // 기존 JWT 형식(service_role) 키는 Authorization 헤더도 필요합니다. 새 sb_secret_ 키는 apikey 만 사용합니다.
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;

  let res: Response;
  try {
    res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ payload }),
      cache: "no-store",
    });
  } catch (e) {
    throw new RpcError("NETWORK", `데이터베이스 서버에 연결할 수 없습니다: ${(e as Error).message}`, 503);
  }
  const body = await res.text();
  if (!res.ok) {
    let code = String(res.status);
    let message = body;
    try {
      const j = JSON.parse(body);
      code = j.code ?? code;
      message = j.message ?? message;
    } catch {
      /* ignore */
    }
    throw new RpcError(code, message, res.status);
  }
  return (body ? JSON.parse(body) : null) as T;
}
