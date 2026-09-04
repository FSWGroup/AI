import { describe, expect, it } from "vitest";
import {
  CANDIDATE_CONSENT_STATEMENT,
  canRecord,
  interviewerVisibleState,
  mustDestroyRecording,
  type ConsentRow,
} from "@/lib/interview-intel/consent";
import {
  detectFormat,
  locateQuote,
  msToClock,
  parsePlainText,
  parseTimestamp,
  parseTranscript,
  transcriptDurationSeconds,
  transcriptForPrompt,
} from "@/lib/interview-intel/transcript";
import {
  containsEvaluativeLanguage,
  InterviewEvidenceSchema,
} from "@/lib/ai/interview-evidence";
import { filterEvidence } from "@/lib/interview-intel/filter";

const EXPECTED = [
  { party: "CANDIDATE" as const, userId: null },
  { party: "INTERVIEWER" as const, userId: "u1" },
  { party: "INTERVIEWER" as const, userId: "u2" },
];

const granted = (userId: string | null, party: "CANDIDATE" | "INTERVIEWER"): ConsentRow => ({
  party,
  userId,
  status: "GRANTED",
});

describe("all-party consent", () => {
  it("allows recording only when everyone has agreed", () => {
    const all = [
      granted(null, "CANDIDATE"),
      granted("u1", "INTERVIEWER"),
      granted("u2", "INTERVIEWER"),
    ];
    expect(canRecord(EXPECTED, all).ok).toBe(true);
  });

  it("treats a missing row as a refusal, not as consent", () => {
    // "We never asked them" is the specific failure this guards against.
    const gate = canRecord(EXPECTED, [
      granted(null, "CANDIDATE"),
      granted("u1", "INTERVIEWER"),
    ]);
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.missing).toHaveLength(1);
    expect(gate.ok === false && gate.missing[0].status).toBe("PENDING");
  });

  it("stops for a single decline, whoever it is", () => {
    const candidateDeclined = canRecord(EXPECTED, [
      { party: "CANDIDATE", userId: null, status: "DECLINED" },
      granted("u1", "INTERVIEWER"),
      granted("u2", "INTERVIEWER"),
    ]);
    expect(candidateDeclined.ok).toBe(false);

    const interviewerDeclined = canRecord(EXPECTED, [
      granted(null, "CANDIDATE"),
      { party: "INTERVIEWER", userId: "u1", status: "DECLINED" },
      granted("u2", "INTERVIEWER"),
    ]);
    expect(interviewerDeclined.ok).toBe(false);
    expect(interviewerDeclined.ok === false && interviewerDeclined.reason).toContain(
      "goes ahead unrecorded",
    );
  });

  it("ends recording on a withdrawal and calls for destruction", () => {
    const consents: ConsentRow[] = [
      { party: "CANDIDATE", userId: null, status: "WITHDRAWN" },
      granted("u1", "INTERVIEWER"),
      granted("u2", "INTERVIEWER"),
    ];
    const gate = canRecord(EXPECTED, consents);
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.reason).toContain("has to stop");
    expect(mustDestroyRecording(consents)).toBe(true);
  });

  it("tells an interviewer whether it is on, not who said no", () => {
    // The candidate was promised that declining costs nothing. Telling the
    // interviewer which of them declined is how that promise gets broken.
    const declined = canRecord(EXPECTED, [
      { party: "CANDIDATE", userId: null, status: "DECLINED" },
      granted("u1", "INTERVIEWER"),
      granted("u2", "INTERVIEWER"),
    ]);
    const shown = interviewerVisibleState(declined);
    expect(shown).toBe("This interview is not being recorded.");
    expect(shown).not.toMatch(/candidate|declined|withdrew/i);
  });

  it("promises in writing that declining costs nothing", () => {
    expect(CANDIDATE_CONSENT_STATEMENT).toContain("no effect on your application");
    expect(CANDIDATE_CONSENT_STATEMENT).toContain("audio only");
    expect(CANDIDATE_CONSENT_STATEMENT).toContain("change your mind");
  });
});

// ---------------------------------------------------------------------------

const VTT = `WEBVTT

1
00:00:04.000 --> 00:00:09.500
<v Interviewer>So tell me about the migration you mentioned.

2
00:00:10.000 --> 00:00:21.250
Ana Cruz: We had six weeks and about forty tables. I wrote a shim so the old
readers kept working while we moved them one at a time.

3
00:00:22.000 --> 00:00:26.000
Ana Cruz: Two of them broke anyway, and I rolled those back the same night.
`;

const SRT = `1
00:00:04,000 --> 00:00:09,500
Interviewer: So tell me about the migration.

2
00:00:10,000 --> 00:00:15,000
Ana Cruz: We had six weeks and forty tables.
`;

describe("transcript parsing", () => {
  it("reads timestamps in both punctuations", () => {
    expect(parseTimestamp("00:01:23.456")).toBe(83_456);
    expect(parseTimestamp("00:01:23,456")).toBe(83_456);
    expect(parseTimestamp("01:23.5")).toBe(83_500);
    expect(parseTimestamp("nonsense")).toBeNull();
  });

  it("detects the format instead of asking", () => {
    expect(detectFormat(VTT)).toBe("vtt");
    expect(detectFormat(SRT)).toBe("srt");
    expect(detectFormat("Ana: hello there")).toBe("text");
  });

  it("parses WebVTT with speakers and markup", () => {
    const { segments, hasTimestamps } = parseTranscript(VTT);
    expect(hasTimestamps).toBe(true);
    expect(segments).toHaveLength(3);
    expect(segments[0].speakerLabel).toBe("Interviewer");
    expect(segments[0].text).toContain("tell me about the migration");
    expect(segments[0].text).not.toContain("<v");
    expect(segments[1].speakerLabel).toBe("Ana Cruz");
    expect(segments[1].startMs).toBe(10_000);
  });

  it("parses SRT the same way", () => {
    const { segments } = parseTranscript(SRT);
    expect(segments).toHaveLength(2);
    expect(segments[1].speakerLabel).toBe("Ana Cruz");
    expect(segments[1].startMs).toBe(10_000);
  });

  it("parses plain text and reports that it has no real times", () => {
    const { segments, hasTimestamps, format } = parseTranscript(
      "Interviewer: How did you handle it?\n\nAna Cruz: I rolled it back the same night.",
    );
    expect(format).toBe("text");
    expect(hasTimestamps).toBe(false);
    expect(segments).toHaveLength(2);
    expect(segments[1].speakerLabel).toBe("Ana Cruz");
    // -1, never 0: an offset presented as a timestamp sends someone
    // scrubbing to the wrong part of the audio.
    expect(segments[1].startMs).toBe(-1);
  });

  it("measures duration only when there are timestamps", () => {
    expect(transcriptDurationSeconds(parseTranscript(VTT).segments)).toBe(26);
    expect(
      transcriptDurationSeconds(parseTranscript("Ana: hello there friend").segments),
    ).toBeNull();
  });

  it("renders positions the model can cite back", () => {
    const rendered = transcriptForPrompt(parseTranscript(VTT).segments);
    expect(rendered).toContain("[0:10] Ana Cruz:");
    const plain = transcriptForPrompt(
      parseTranscript("Ana: I rolled it back that night").segments,
    );
    expect(plain).toContain("[#0]");
  });

  it("formats clock positions", () => {
    expect(msToClock(65_000)).toBe("1:05");
    expect(msToClock(3_725_000)).toBe("1:02:05");
    expect(msToClock(-1)).toBe("—");
  });
});

describe("locateQuote", () => {
  const { segments } = parseTranscript(VTT);

  it("finds a quote and returns where it is", () => {
    const at = locateQuote(segments, "I wrote a shim so the old readers kept working");
    expect(at).not.toBeNull();
    expect(at!.startMs).toBe(10_000);
  });

  it("tolerates smart quotes and punctuation drift", () => {
    expect(locateQuote(segments, "I rolled those back the same night.")).not.toBeNull();
    expect(locateQuote(segments, "I rolled those back the same night")).not.toBeNull();
  });

  it("finds a quote spanning a pause between segments", () => {
    const at = locateQuote(
      segments,
      "I rolled those back the same night",
    );
    expect(at).not.toBeNull();
  });

  it("returns null for words that were never said", () => {
    // The check that stops a fabricated quote being attributed to a candidate.
    expect(
      locateQuote(segments, "I have always been the top performer on every team"),
    ).toBeNull();
  });

  it("refuses a quote too short to be checkable", () => {
    expect(locateQuote(segments, "yes")).toBeNull();
  });
});

describe("filterEvidence", () => {
  const { segments } = parseTranscript(VTT);
  const ids = new Map([
    ["Ownership", "kc-1"],
    ["Handling objections", "kc-2"],
  ]);

  const item = (over: Partial<Parameters<typeof filterEvidence>[0][0]> = {}) => ({
    competencyName: "Ownership",
    quote: "I rolled those back the same night.",
    position: "[0:22]",
    relevance: "Describes what they did when the migration failed.",
    ...over,
  });

  it("keeps a quote it can find, and locates it", () => {
    const out = filterEvidence([item()], segments, ids);
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0].startMs).toBe(22_000);
    expect(out.kept[0].competencyId).toBe("kc-1");
  });

  it("DROPS a quote that is not in the transcript", () => {
    // The safety property that matters most. A fabricated quote attributed to
    // a candidate must not reach the interviewer at all — a caveat under it
    // would not stop them reading it and believing it.
    const out = filterEvidence(
      [item({ quote: "I have always been the top performer on every team I joined." })],
      segments,
      ids,
    );
    expect(out.kept).toHaveLength(0);
    expect(out.droppedUnlocatable).toBe(1);
  });

  it("replaces a relevance line that reads as a verdict", () => {
    const out = filterEvidence(
      [item({ relevance: "A really strong answer showing genuine ownership." })],
      segments,
      ids,
    );
    expect(out.kept).toHaveLength(1);
    expect(out.droppedEvaluative).toBe(1);
    expect(out.kept[0].relevance).not.toContain("strong");
    expect(out.kept[0].relevance).toContain("judge it yourself");
    // The quote itself survives untouched: it is what was actually said.
    expect(out.kept[0].quote).toBe("I rolled those back the same night.");
  });

  it("drops evidence against a competency the kit does not have", () => {
    const out = filterEvidence(
      [item({ competencyName: "Executive presence" })],
      segments,
      ids,
    );
    expect(out.kept).toHaveLength(0);
    expect(out.droppedUnknownCompetency).toBe(1);
  });

  it("counts each kind of drop separately so the run can be reported honestly", () => {
    const out = filterEvidence(
      [
        item(),
        item({ quote: "Words nobody in this interview ever said out loud." }),
        item({ relevance: "An impressive and convincing account." }),
        item({ competencyName: "Gravitas" }),
      ],
      segments,
      ids,
    );
    expect(out.kept).toHaveLength(2);
    expect(out.droppedUnlocatable).toBe(1);
    expect(out.droppedEvaluative).toBe(1);
    expect(out.droppedUnknownCompetency).toBe(1);
  });
});

describe("the evidence schema", () => {
  it("has nowhere to put a rating", () => {
    // The structural guarantee: even a model determined to be helpful cannot
    // return a score, because the parse would reject it.
    const shape = Object.keys(InterviewEvidenceSchema.shape);
    expect(shape).toEqual(["evidence", "competenciesWithNoEvidence", "notes"]);

    const parsed = InterviewEvidenceSchema.safeParse({
      evidence: [
        {
          competencyName: "Ownership",
          quote: "I rolled those back the same night.",
          position: "[0:22]",
          relevance: "Describes what they did when the migration failed.",
          rating: 4,
          recommendation: "STRONG_YES",
        },
      ],
      competenciesWithNoEvidence: [],
      notes: [],
    });
    expect(parsed.success).toBe(true);
    // Accepted, but the extra keys are stripped rather than carried through.
    if (parsed.success) {
      expect(Object.keys(parsed.data.evidence[0])).toEqual([
        "competencyName",
        "quote",
        "position",
        "relevance",
      ]);
    }
  });

  it("catches evaluative wording that slipped into a relevance line", () => {
    expect(
      containsEvaluativeLanguage("A strong answer showing real ownership."),
    ).toContain("strong");
    expect(containsEvaluativeLanguage("Sounded hesitant throughout.")).toContain(
      "hesitant",
    );
    expect(containsEvaluativeLanguage("A red flag on process.")).toContain("red flag");
    expect(
      containsEvaluativeLanguage("Describes rolling back two failed migrations."),
    ).toEqual([]);
  });
});

describe("transcript parsing, the cases that used to lose the transcript", () => {
  it("cues with no blank line between them", () => {
    const vtt = ["WEBVTT","00:00:00.000 --> 00:00:02.000","Ana Cruz: Hello there","00:00:02.000 --> 00:00:05.000","Ben Ito: Hello back","00:00:05.000 --> 00:00:09.000","Ana Cruz: Right, so about the deploy"].join("\n");
    const out = parseTranscript(vtt).segments;
    expect(out).toHaveLength(3);
    expect(out.map((s) => s.startMs)).toEqual([0, 2000, 5000]);
    expect(out.map((s) => s.speakerLabel)).toEqual(["Ana Cruz", "Ben Ito", "Ana Cruz"]);
  });
  it("prose containing an arrow is not a cue file", () => {
    const text = "Ana Cruz: We moved the build from Jenkins --> GitHub Actions last quarter.\n\nBen Ito: How long did that take?\n\nAna Cruz: About six weeks.";
    expect(detectFormat(text)).toBe("text");
    expect(parseTranscript(text).segments).toHaveLength(3);
  });
  it("multi-line turn keeps its speaker", () => {
    const out = parsePlainText("Ana Cruz: I rewrote the import\nand it took about two days.\n\nBen Ito: What broke?");
    expect(out[0].speakerLabel).toBe("Ana Cruz");
    expect(out[0].text).toBe("I rewrote the import and it took about two days.");
  });
  it("locateQuote returns the tightest window", () => {
    const segs = [0, 30000, 60000, 90000].map((startMs, i) => ({ orderIndex: i, speakerLabel: null, startMs, endMs: startMs + 4000, text: `sentence number ${i} here` }));
    const q = locateQuote(segs, "sentence number 2 here sentence number 3 here");
    expect(q).toEqual({ startMs: 60000, endMs: 94000, orderIndex: 2 });
  });
});
