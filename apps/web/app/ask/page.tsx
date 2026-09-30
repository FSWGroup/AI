import { askAgent } from "@wpi/core";
import { getContext } from "@/lib/session";
import { AnswerView } from "@/components/AnswerView";

const EXAMPLES = [
  "What is the pressure rating of BVW-S70-200?",
  "Cross reference for BVW-S70-200",
  "Can Welsford sell BVW-S70-200 to a customer in PA?",
  "I need a 2 inch stainless ball valve rated for 150 psi steam",
  "Is BVW-S40-100 in stock?",
  "Datasheet for Bramwell Series 70",
];

export default async function AskPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const question = (q ?? "").trim().slice(0, 2000);
  const { ctx, session } = await getContext();
  const answer = question ? await askAgent(ctx, question) : null;
  return (
    <div className="space-y-4">
      <h1>Ask</h1>
      <form method="get" className="panel p-3">
        <label className="block text-slate-600">Product question (routed deterministically to a specialized agent; unclassifiable questions abstain)</label>
        <div className="mt-1 flex gap-2">
          <input type="text" name="q" defaultValue={question} placeholder="e.g. What is the max temperature of BVW-S70-200?" className="w-full" autoFocus />
          <button className="btn" type="submit">Ask</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1 text-[11.5px] text-slate-500">
          examples: {EXAMPLES.map((e) => <a key={e} href={`/ask?q=${encodeURIComponent(e)}`} className="rounded border border-slate-200 px-1.5 py-[1px]">{e}</a>)}
        </div>
      </form>
      {answer ? <AnswerView answer={answer} canReport={session.canReview} /> : <p className="text-slate-500">Ask a question to get an evidence-gated answer. Acting as <b>{session.principal.displayName}</b> in channel <b>{session.channel}</b>{session.state ? <> for state <b>{session.state}</b></> : null}.</p>}
    </div>
  );
}
