import { handleApi } from "@/server/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function handler(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return handleApi(req, path);
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
