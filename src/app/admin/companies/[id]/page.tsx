import AdminApp from "@/components/admin/AdminApp";

export const metadata = { title: "업체 상세 · BEAUTY WAVE 2026 관리자" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = await params;
  const { edit } = await searchParams;
  return <AdminApp view="company" companyId={id} edit={edit === "1"} />;
}
