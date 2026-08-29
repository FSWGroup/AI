"use client";

/**
 * Voluntary self-identification, shown after the assessment is submitted.
 *
 * Deliberate design choices:
 *  - It appears only AFTER submission, so it cannot influence any result.
 *  - Every question can be declined, and skipping entirely is one click.
 *  - The copy states plainly what it is used for and who cannot see it.
 */

import { useState } from "react";
import { api } from "@/lib/client/api";
import { Button, Card, Select } from "@/components/ui";

const SEX = [
  ["", "Select…"],
  ["MALE", "Male"],
  ["FEMALE", "Female"],
  ["NON_BINARY", "Non-binary"],
  ["DECLINE", "I prefer not to say"],
];

const RACE = [
  ["", "Select…"],
  ["HISPANIC_LATINO", "Hispanic or Latino"],
  ["WHITE", "White"],
  ["BLACK_AFRICAN_AMERICAN", "Black or African American"],
  ["ASIAN", "Asian"],
  ["NATIVE_HAWAIIAN_PACIFIC_ISLANDER", "Native Hawaiian or Other Pacific Islander"],
  ["AMERICAN_INDIAN_ALASKA_NATIVE", "American Indian or Alaska Native"],
  ["TWO_OR_MORE", "Two or more races"],
  ["DECLINE", "I prefer not to say"],
];

const VETERAN = [
  ["", "Select…"],
  ["VETERAN", "I identify as a protected veteran"],
  ["NOT_VETERAN", "I am not a protected veteran"],
  ["DECLINE", "I prefer not to say"],
];

const DISABILITY = [
  ["", "Select…"],
  ["YES", "Yes, I have or have had a disability"],
  ["NO", "No"],
  ["DECLINE", "I prefer not to say"],
];

export function SelfIdentification({ onDone }: { onDone: () => void }) {
  const [sex, setSex] = useState("");
  const [raceEthnicity, setRace] = useState("");
  const [veteranStatus, setVeteran] = useState("");
  const [disabilityStatus, setDisability] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    try {
      await api("/api/candidate/eeo", {
        body: {
          sex: sex || undefined,
          raceEthnicity: raceEthnicity || undefined,
          veteranStatus: veteranStatus || undefined,
          disabilityStatus: disabilityStatus || undefined,
        },
      });
    } catch {
      // Never block the candidate on this — it is entirely optional.
    } finally {
      setBusy(false);
      onDone();
    }
  }

  const field = (
    label: string,
    value: string,
    setter: (v: string) => void,
    options: string[][],
  ) => (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-navy-800">
        {label}
      </label>
      <Select value={value} onChange={(e) => setter(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    </div>
  );

  return (
    <Card className="p-8">
      <h2 className="text-xl font-bold text-navy-900">
        Voluntary self-identification
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-navy-600">
        Your assessment is already submitted — this does not affect it in any
        way. Employers monitor the fairness of their hiring process in
        aggregate, and that only works if some people choose to answer.
      </p>
      <ul className="mt-4 space-y-1.5 rounded-xl bg-navy-50 p-4 text-sm text-navy-700">
        <li>• Completely voluntary. You can skip this entirely.</li>
        <li>• Every question has a &ldquo;prefer not to say&rdquo; option.</li>
        <li>• Kept separately from your results and never shown to the people evaluating you.</li>
        <li>• Used only for aggregate fairness reporting — never to score, rank, or screen anyone.</li>
      </ul>

      <div className="mt-6 space-y-4">
        {field("Sex", sex, setSex, SEX)}
        {field("Race / ethnicity", raceEthnicity, setRace, RACE)}
        {field("Veteran status", veteranStatus, setVeteran, VETERAN)}
        {field("Disability status", disabilityStatus, setDisability, DISABILITY)}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button disabled={busy} onClick={() => void submit()}>
          Submit
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onDone}>
          Skip this
        </Button>
      </div>
    </Card>
  );
}
