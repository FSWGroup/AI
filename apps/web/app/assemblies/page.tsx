import { assemblyAgent } from "@wpi/core";
import { getContext } from "@/lib/session";
import { AnswerView } from "@/components/AnswerView";

type Params = { pn?: string; actuation?: string; psi?: string; sf?: string; volt?: string; ls?: string };

export default async function AssembliesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const pn = (p.pn ?? "").trim().slice(0, 200);
  const actuation = p.actuation === "double_acting" ? "double_acting" : "spring_return";
  const psi = p.psi?.trim() ? Number(p.psi) : null;
  const sf = p.sf?.trim() ? Number(p.sf) : null;
  const { ctx, session } = await getContext();
  const answer = pn ? await assemblyAgent(ctx, { valvePartNumber: pn, actuation, supplyPressurePsi: Number.isFinite(psi as number) ? psi : null, safetyFactor: Number.isFinite(sf as number) ? sf : null, solenoidVoltage: p.volt?.trim() || null, includeLimitSwitch: p.ls === "on" }) : null;
  return (
    <div className="space-y-4">
      <h1>Actuated Assemblies</h1>
      <form method="get" className="panel p-3">
        <div className="grid gap-2 md:grid-cols-6">
          <label className="block md:col-span-2">Valve part number<br /><input type="text" name="pn" defaultValue={pn} className="mono w-full" placeholder="BVW-S70-200" autoFocus /></label>
          <label className="block">Actuation<br /><select name="actuation" defaultValue={actuation} className="w-full"><option value="spring_return">spring return</option><option value="double_acting">double acting</option></select></label>
          <label className="block">Supply (psi)<br /><input type="number" name="psi" defaultValue={p.psi ?? "80"} className="mono w-full" /></label>
          <label className="block">Safety factor<br /><input type="number" step="0.05" name="sf" defaultValue={p.sf ?? "1.25"} className="mono w-full" /></label>
          <label className="block">Solenoid voltage<br /><input type="text" name="volt" defaultValue={p.volt ?? ""} className="mono w-full" placeholder="120VAC" /></label>
        </div>
        <div className="mt-2 flex items-center gap-4">
          <label className="flex items-center gap-1"><input type="checkbox" name="ls" defaultChecked={p.ls === "on"} /> include limit switch</label>
          <button className="btn" type="submit">Size assembly</button>
          <span className="text-slate-500">required torque = verified break torque × safety factor; no interpolation across supply pressures.</span>
        </div>
      </form>
      {answer ? <AnswerView answer={answer} canReport={session.canReview} /> : null}
    </div>
  );
}
