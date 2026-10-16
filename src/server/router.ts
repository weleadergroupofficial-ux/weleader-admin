import { validateSubmission } from "@/lib/validation";
import { DEFAULT_SURVEY_URL, EVENT_DATES, validateSales, type SalesEntry } from "@/lib/event";
import type { AdminOverview, AuditLog, PublicSubmitState, Submission } from "@/lib/types";
import { buildExportDoc, buildImportTemplate, EXPORT_FILES, type ExportType } from "./exports";
import { buildPdf } from "./pdf";
import {
  authConfig,
  checkPassword,
  createSessionToken,
  readCookie,
  SESSION_COOKIE,
  sessionCookieHeader,
  verifySessionToken,
} from "./session";
import { ConfigError, rpc, RpcError } from "./supabase";
import { buildXlsx, readCsvFirstColumn, readFirstColumn } from "./xlsx";

/**
 * 모든 API 요청의 단일 진입점. 웹 표준 Request → Response 이므로
 * Next.js Route Handler 와 로컬 테스트 서버에서 그대로 사용합니다.
 */

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE, ...headers },
  });
}

const DB_ERRORS: Record<string, [number, string]> = {
  BW_LOCKED: [423, "운영사무국에서 제출 내용을 확정해 더 이상 수정할 수 없습니다. 변경이 필요하면 운영사무국에 연락해 주세요."],
  BW_CLOSED: [423, "제출 기간이 마감되었습니다. 변경이 필요하면 운영사무국에 연락해 주세요."],
  BW_CONFLICT: [409, "다른 곳에서 먼저 저장된 내용이 있습니다. 새로고침해 최신 내용을 확인한 뒤 다시 저장해 주세요."],
  BW_COMPANY_NOT_FOUND: [404, "업체 정보를 찾을 수 없습니다. 목록을 새로고침해 주세요."],
  BW_NOT_SUBMITTED: [404, "아직 제출된 정보가 없습니다."],
  BW_SURVEY_REQUIRED: [422, "행사 마지막 날(10/25) 판매실적은 만족도조사를 완료한 뒤에 제출할 수 있습니다."],
  BW_BAD_REQUEST: [400, "입력값이 올바르지 않습니다. 내용을 확인해 주세요."],
};

function toResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
  if (e instanceof ConfigError) {
    console.error("[config]", e.message);
    return json({ error: `서버 설정이 완료되지 않았습니다. ${e.message}` }, 500);
  }
  if (e instanceof RpcError) {
    const key = Object.keys(DB_ERRORS).find((k) => e.message.includes(k));
    if (key) {
      const [status, msg] = DB_ERRORS[key];
      return json({ error: msg, code: key }, status);
    }
    if (e.code === "23505") return json({ error: "같은 이름의 업체가 이미 등록되어 있습니다." }, 409);
    if (["23514", "23502", "22P02", "22003"].includes(e.code)) return json({ error: "입력값이 허용 범위를 벗어났습니다. 내용을 확인해 주세요." }, 400);
    if ((e.code === "PGRST202" || e.code === "42883" || e.code === "42P01") && /sales/i.test(e.message))
      return json({ error: "판매실적 데이터베이스 설정이 아직 적용되지 않았습니다. 운영사무국에 문의해 주세요." }, 500);
    if (e.code === "PGRST202" || e.code === "42883")
      return json({ error: "데이터베이스 함수가 없습니다. supabase/schema.sql 을 실행했는지 확인해 주세요." }, 500);
    if (e.status === 401 || e.status === 403 || e.code === "42501")
      return json({ error: "데이터베이스 접근 권한이 없습니다. SUPABASE_SERVICE_ROLE_KEY 값을 확인해 주세요." }, 500);
    if (e.code === "NETWORK") return json({ error: e.message }, 503);
    console.error("[rpc]", e.code, e.message);
    return json({ error: "데이터베이스 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." }, 500);
  }
  console.error("[api]", e);
  return json({ error: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." }, 500);
}

async function readJson(req: Request, limit = 64 * 1024): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > limit) throw new HttpError(413, "요청 크기가 너무 큽니다.");
  try {
    const v = JSON.parse(text || "{}");
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, "요청 형식이 올바르지 않습니다.");
  }
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function isHttps(req: Request) {
  return (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https";
}

function baseUrl(req: Request) {
  const env = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
  if (env) return env;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  return `${isHttps(req) ? "https" : "http"}://${host}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;

function uuid(v: string | undefined): string {
  if (!v || !UUID.test(v)) throw new HttpError(404, "업체 정보를 찾을 수 없습니다.");
  return v;
}

// 로그인 시도 제한 (인스턴스 메모리 기준, 15분 10회)
const attempts = new Map<string, { n: number; at: number }>();
function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}
function tooManyAttempts(ip: string) {
  const a = attempts.get(ip);
  if (!a) return false;
  if (Date.now() - a.at > 15 * 60 * 1000) {
    attempts.delete(ip);
    return false;
  }
  return a.n >= 10;
}
function recordFailure(ip: string) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.at > 15 * 60 * 1000) attempts.set(ip, { n: 1, at: Date.now() });
  else a.n++;
}

async function requireAdmin(req: Request) {
  const ok = await verifySessionToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
  if (!ok) throw new HttpError(401, "로그인이 필요합니다. 다시 로그인해 주세요.", { code: "UNAUTHORIZED" });
}

function cleanNames(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (!v || v === "업체명" || v === "참가업체명" || v.includes("○○")) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v.slice(0, 100));
  }
  return out;
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function originOf(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  return `${isHttps(req) ? "https" : "http"}://${host}`;
}

function fileResponse(bytes: Uint8Array, filename: string, type = XLSX_TYPE) {
  const ext = filename.endsWith(".pdf") ? "pdf" : "xlsx";
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="export.${ext}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

function stamp() {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace(/[^0-9]/g, "");
  return p.slice(0, 12);
}

// ---------------------------------------------------------------------

async function route(req: Request, path: string[]): Promise<Response> {
  const method = req.method.toUpperCase();
  const [a, b, c, d] = path;

  if (method !== "GET" && method !== "HEAD" && !sameOrigin(req)) {
    throw new HttpError(403, "허용되지 않은 요청입니다.");
  }

  // ----- 참가업체(공개) : /api/submit/:token -----
  if (a === "submit" && b && !c) {
    if (!TOKEN.test(b)) throw new HttpError(404, "유효하지 않은 링크입니다. 운영사무국에서 받은 링크를 다시 확인해 주세요.");
    const state = await rpc<(PublicSubmitState & { company: { id: string } }) | null>("bw_get_by_token", { token: b });
    if (!state) throw new HttpError(404, "유효하지 않은 링크입니다. 운영사무국에서 받은 링크를 다시 확인해 주세요.");

    if (method === "GET") {
      const { company, submissionOpen, submission } = state;
      return json({ company: { name: company.name, isLocked: company.isLocked }, submissionOpen, submission });
    }
    if (method === "POST") {
      if (!state.submissionOpen) throw new HttpError(423, DB_ERRORS.BW_CLOSED[1], { code: "BW_CLOSED" });
      if (state.company.isLocked) throw new HttpError(423, DB_ERRORS.BW_LOCKED[1], { code: "BW_LOCKED" });
      const body = await readJson(req);
      const v = validateSubmission(body.data);
      if (!v.ok) throw new HttpError(422, "입력 내용을 확인해 주세요.", { fieldErrors: v.errors });
      const expectedRevision = typeof body.expectedRevision === "number" ? body.expectedRevision : null;
      const submission = await rpc<Submission>("bw_save_submission", {
        actor: "company",
        companyId: state.company.id,
        expectedRevision,
        data: v.value,
      });
      return json({ submission });
    }
    throw new HttpError(405, "지원하지 않는 요청입니다.");
  }

  // ----- 참가업체(공개) : 판매실적 /api/sales/:token[/:day] -----
  if (a === "sales" && b) {
    if (!TOKEN.test(b)) throw new HttpError(404, "유효하지 않은 링크입니다. 운영사무국에서 받은 링크를 다시 확인해 주세요.");
    const state = await rpc<{ company: { id: string; name: string } } | null>("bw_get_by_token", { token: b });
    if (!state) throw new HttpError(404, "유효하지 않은 링크입니다. 운영사무국에서 받은 링크를 다시 확인해 주세요.");
    const surveyUrl = DEFAULT_SURVEY_URL;

    if (!c && method === "GET") {
      const entries = await rpc<SalesEntry[]>("bw_get_sales", { companyId: state.company.id });
      return json({ company: { name: state.company.name }, entries, surveyUrl });
    }
    if (c && method === "PUT") {
      if (!EVENT_DATES.includes(c)) throw new HttpError(404, "행사 일자가 올바르지 않습니다.");
      const body = await readJson(req, 4096);
      const v = validateSales(body);
      if (!v.ok) throw new HttpError(422, "입력 내용을 확인해 주세요.", { fieldErrors: v.errors });
      const entry = await rpc<SalesEntry>("bw_save_sales", {
        companyId: state.company.id,
        day: c,
        items: v.items,
        amount: v.amount,
        surveyDone: v.surveyDone,
      });
      return json({ entry });
    }
    throw new HttpError(405, "지원하지 않는 요청입니다.");
  }

  // ----- 단일 링크 접속 : 업체 선택 + 확인번호 -----
  if (a === "entry") {
    if (b === "companies" && method === "GET") {
      // 참가정보 제출 여부를 함께 내려 줍니다 (토큰 등 민감 정보는 제외)
      const overview = await rpc<AdminOverview>("bw_admin_overview");
      return json(overview.companies.map((c) => ({ id: c.id, name: c.name, submitted: !!c.submission })));
    }
    if (b === "verify" && method === "POST") {
      const body = await readJson(req, 4096);
      const companyId = uuid(typeof body.companyId === "string" ? body.companyId : undefined);
      const code = typeof body.code === "string" ? body.code.trim() : "";
      if (!/^[0-9]{4}$/.test(code)) throw new HttpError(400, "휴대폰 번호 뒷자리 숫자 4자리를 입력해 주세요.");
      const r = await rpc<{ status: string; token?: string; remaining?: number; until?: string }>("bw_verify_entry", { companyId, code });
      if (r.status === "ok" && r.token) return json({ token: r.token });
      if (r.status === "no_code")
        throw new HttpError(403, "이 업체는 확인번호가 등록되어 있지 않습니다. 운영사무국에 문의해 주세요.");
      if (r.status === "locked")
        throw new HttpError(429, "확인번호를 여러 번 잘못 입력했습니다. 10분 뒤 다시 시도하거나 운영사무국에 문의해 주세요.");
      throw new HttpError(401, `확인번호가 맞지 않습니다. 신청서에 적은 담당자 휴대폰 번호 뒷자리를 확인해 주세요. (남은 기회 ${r.remaining ?? 0}번)`);
    }
    throw new HttpError(404, "요청한 주소를 찾을 수 없습니다.");
  }

  if (a !== "admin") throw new HttpError(404, "요청한 주소를 찾을 수 없습니다.");

  // ----- 관리자 인증 -----
  if (b === "login" && method === "POST") {
    if (!authConfig()) {
      throw new HttpError(500, "관리자 비밀번호(ADMIN_PASSWORD, 6자 이상)와 SESSION_SECRET(32자 이상) 환경변수를 설정해 주세요.");
    }
    const ip = clientIp(req);
    if (tooManyAttempts(ip)) throw new HttpError(429, "로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.");
    const body = await readJson(req, 4096);
    const ok = typeof body.password === "string" && (await checkPassword(body.password));
    if (!ok) {
      recordFailure(ip);
      await new Promise((r) => setTimeout(r, 400));
      throw new HttpError(401, "비밀번호가 올바르지 않습니다.");
    }
    attempts.delete(ip);
    const token = await createSessionToken();
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookieHeader(token, isHttps(req)) });
  }
  if (b === "logout" && method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookieHeader("", isHttps(req), 0) });
  }

  await requireAdmin(req);

  if (b === "session" && method === "GET") return json({ ok: true });

  if (b === "overview" && method === "GET") {
    return json(await rpc<AdminOverview>("bw_admin_overview"));
  }

  if (b === "logs" && method === "GET") {
    return json(await rpc<AuditLog[]>("bw_list_logs", { limit: 500 }));
  }

  if (b === "settings" && method === "PATCH") {
    const body = await readJson(req);
    if (typeof body.submissionOpen !== "boolean") throw new HttpError(400, "입력값이 올바르지 않습니다.");
    return json(await rpc("bw_set_settings", { submissionOpen: body.submissionOpen }));
  }

  if (b === "sales" && method === "GET") {
    return json(await rpc<SalesEntry[]>("bw_admin_sales"));
  }

  if (b === "template" && method === "GET") {
    return fileResponse(await buildXlsx(buildImportTemplate()), "참가업체_일괄등록_양식.xlsx");
  }

  if (b === "export" && c && method === "GET") {
    if (!(c in EXPORT_FILES)) throw new HttpError(404, "알 수 없는 다운로드 형식입니다.");
    const type = c as ExportType;
    const format = new URL(req.url).searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
    const overview = await rpc<AdminOverview>("bw_admin_overview");
    let sales: SalesEntry[] = [];
    if (type === "sales" || type === "sales-report") sales = await rpc<SalesEntry[]>("bw_admin_sales");
    const doc = buildExportDoc(type, overview.companies, baseUrl(req), sales);
    const filename = `BEAUTYWAVE2026_${EXPORT_FILES[type]}_${stamp()}.${format}`;
    if (format === "pdf") return fileResponse(await buildPdf(doc, originOf(req)), filename, "application/pdf");
    return fileResponse(await buildXlsx(doc), filename);
  }

  if (b === "companies") {
    // 일괄 등록 (이름 목록)
    if (!c && method === "POST") {
      const body = await readJson(req);
      const names = Array.isArray(body.names) ? cleanNames(body.names.filter((n): n is string => typeof n === "string")) : [];
      if (names.length === 0) throw new HttpError(400, "등록할 업체명을 1개 이상 입력해 주세요.");
      if (names.length > 200) throw new HttpError(400, "한 번에 최대 200개 업체까지 등록할 수 있습니다.");
      return json(await rpc("bw_add_companies", { names }));
    }
    // 엑셀/CSV 파일 일괄 등록
    if (c === "import" && method === "POST") {
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        throw new HttpError(400, "파일을 읽을 수 없습니다.");
      }
      const file = form.get("file");
      if (!file || typeof file === "string") throw new HttpError(400, "업로드할 파일을 선택해 주세요.");
      if (file.size > 2 * 1024 * 1024) throw new HttpError(413, "파일은 2MB 이하만 업로드할 수 있습니다.");
      const lower = file.name.toLowerCase();
      let values: string[];
      try {
        if (lower.endsWith(".xlsx")) values = await readFirstColumn(await file.arrayBuffer());
        else if (lower.endsWith(".csv") || lower.endsWith(".txt")) values = readCsvFirstColumn(await file.text());
        else throw new HttpError(400, "엑셀(.xlsx) 또는 CSV 파일만 업로드할 수 있습니다. (.xls 는 .xlsx 로 다시 저장해 주세요)");
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, "파일 내용을 읽을 수 없습니다. 양식 파일을 내려받아 A열에 업체명을 입력해 주세요.");
      }
      const names = cleanNames(values);
      if (names.length === 0) throw new HttpError(400, "파일의 A열에서 업체명을 찾지 못했습니다.");
      if (names.length > 200) throw new HttpError(400, "한 번에 최대 200개 업체까지 등록할 수 있습니다.");
      return json(await rpc("bw_add_companies", { names }));
    }

    const id = uuid(c);
    if (!d) {
      if (method === "PATCH") {
        const body = await readJson(req);
        const payload: Record<string, unknown> = { companyId: id };
        if (body.name !== undefined) {
          if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100)
            throw new HttpError(400, "업체명은 1~100자로 입력해 주세요.");
          payload.name = body.name.trim();
        }
        if (body.verifyCode !== undefined) {
          if (body.verifyCode !== null && (typeof body.verifyCode !== "string" || !/^[0-9]{4}$/.test(body.verifyCode)))
            throw new HttpError(400, "확인번호는 숫자 4자리로 입력해 주세요.");
          payload.verifyCode = body.verifyCode ?? "";
        }
        if (body.isLocked !== undefined) {
          if (typeof body.isLocked !== "boolean") throw new HttpError(400, "입력값이 올바르지 않습니다.");
          payload.isLocked = body.isLocked;
        }
        return json(await rpc("bw_update_company", payload));
      }
      if (method === "DELETE") return json(await rpc("bw_delete_company", { companyId: id }));
    }
    if (d === "token" && method === "POST") {
      return json(await rpc("bw_regenerate_token", { companyId: id }));
    }
    if (d === "submission") {
      if (method === "PUT") {
        const body = await readJson(req);
        const v = validateSubmission(body.data);
        if (!v.ok) throw new HttpError(422, "입력 내용을 확인해 주세요.", { fieldErrors: v.errors });
        const expectedRevision = typeof body.expectedRevision === "number" ? body.expectedRevision : null;
        const submission = await rpc<Submission>("bw_save_submission", {
          actor: "admin",
          companyId: id,
          expectedRevision,
          data: v.value,
        });
        return json({ submission });
      }
      if (method === "DELETE") return json(await rpc("bw_delete_submission", { companyId: id }));
    }
  }

  throw new HttpError(404, "요청한 주소를 찾을 수 없습니다.");
}

export async function handleApi(req: Request, path: string[]): Promise<Response> {
  try {
    return await route(req, path);
  } catch (e) {
    return toResponse(e);
  }
}

