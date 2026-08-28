import type { Metadata } from 'next';
import { requireCtx } from '@/lib/authz';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { aiEnabled } from '@/lib/ai/client';
import { AssistantPanel } from './assistant-ui';

export const metadata: Metadata = { title: 'Assistant' };
export const dynamic = 'force-dynamic';

export default async function AssistantPage() {
  // Signing in is the only gate. The assistant answers from what this person
  // can already read, so a wide audience never means wide access.
  await requireCtx();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="HR assistant"
        description="Answers from your handbook and your own record — with the policy it came from."
      />
      <Card>
        <CardHeader
          title="Ask anything about working here"
          description="It reads only the policies you are entitled to see and the facts on your own record. It cannot see a colleague's information, and it cannot change anything."
        />
        <CardBody>
          <AssistantPanel configured={aiEnabled()} />
        </CardBody>
      </Card>
    </div>
  );
}
