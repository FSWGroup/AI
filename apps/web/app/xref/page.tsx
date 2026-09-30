import { crossReferenceAgent } from "@wpi/core";
import { getContext } from "@/lib/session";
import { AnswerView } from "@/components/AnswerView";

export default async function XrefPage({ searchParams }: { searchParams: Promise<{ pn?: string; mfr?: string }> }) {
  const { pn, mfr } = await searchParams;
  const partNumber = (pn ?? "").trim().slice(0, 200);
  const { ctx, session } = await getContext();
  const answer = partNumber ? await crossReferenceAgent(ctx, { partNumber, manufacturer: mfr?.trim() || null }) : null;
  return (
    <div className="space-y-4">
      <h1>Cross Reference</h1>
      <form method="get" className="panel p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">Part number (catalog, historical or competitor)<br /><input type="text" name="pn" defaultValue={partNumber} className="mono w-72" placeholder="BVW-S70-200" autoFocus /></label>
          <label className="block">Manufacturer (optional)<br /><input type="text" name="mfr" defaultValue={mfr ?? ""} className="w-48" placeholder="Bramwell" /></label>
          <button className="btn" type="submit">Cross reference</button>
        </div>
        <p className="mt-2 text-slate-500">Four categories are kept strictly separate: manufacturer-approved substitutes, Welsford-approved substitutes, technically similar (not substitutes), and possible matches requiring review.</p>
      </form>
      {answer ? <AnswerView answer={answer} canReport={session.canReview} /> : null}
    </div>
  );
}
