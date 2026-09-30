import { productFinderAgent } from "@wpi/core";
import { getContext } from "@/lib/session";
import { AnswerView } from "@/components/AnswerView";

export default async function FinderPage({ searchParams }: { searchParams: Promise<{ text?: string }> }) {
  const { text } = await searchParams;
  const req = (text ?? "").trim().slice(0, 4000);
  const { ctx, session } = await getContext();
  const answer = req ? await productFinderAgent(ctx, { text: req, channel: session.channel, state: session.state }) : null;
  return (
    <div className="space-y-4">
      <h1>Product Finder</h1>
      <form method="get" className="panel p-3">
        <label className="block text-slate-600">Describe the application / requirements. EXPLICIT requirements filter; INFERRED ones are labeled assumptions; UNKNOWN ones become questions.</label>
        <textarea name="text" rows={4} defaultValue={req} className="mt-1 w-full" placeholder={"2\" stainless steel ball valve, NPT, 150 psi steam service, needs to be lead free"} />
        <div className="mt-2 flex items-center gap-3"><button className="btn" type="submit">Find products</button><span className="text-slate-500">channel {session.channel}{session.state ? ` · state ${session.state}` : ""}</span></div>
      </form>
      {answer ? <AnswerView answer={answer} canReport={session.canReview} /> : null}
    </div>
  );
}
