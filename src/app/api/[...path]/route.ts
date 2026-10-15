import { handleApi } from "@/server/router";

export const runtime = "nodejs";
// 데이터베이스(Supabase)가 서울 리전이므로 함수도 서울(icn1)에서 실행해 응답 지연을 줄입니다.
export const preferredRegion = "icn1";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function handler(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return handleApi(req, path);
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
