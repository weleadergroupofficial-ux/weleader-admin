import SubmitApp from "@/components/submit/SubmitApp";

export const dynamic = "force-dynamic";

export default async function SubmitPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SubmitApp token={token} />;
}
