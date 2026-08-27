import { CandidateApp } from "@/components/candidate/CandidateApp";

export const dynamic = "force-dynamic";

export default async function AssessmentResumePage({
  params,
}: {
  params: Promise<{ resumeToken: string }>;
}) {
  const { resumeToken } = await params;
  return <CandidateApp resumeToken={resumeToken} />;
}
