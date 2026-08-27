import { CandidateApp } from "@/components/candidate/CandidateApp";

export const dynamic = "force-dynamic";

export default async function AssessmentEntryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <CandidateApp invitationToken={token} />;
}
