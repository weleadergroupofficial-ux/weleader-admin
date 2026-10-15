import SalesApp from "@/components/submit/SalesApp";

export const dynamic = "force-dynamic";
export const metadata = { title: "판매실적 입력 · BEAUTY WAVE in INCHEON 2026" };

export default async function SalesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SalesApp token={token} />;
}
