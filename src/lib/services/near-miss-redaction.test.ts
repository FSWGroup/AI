import { describe, it, expect } from "vitest";
import {
  findIdentifiers,
  hasBlockingIdentifiers,
  summarizeBlocking,
  type DirectoryPerson,
} from "@/lib/services/near-miss-redaction";

/**
 * The blameless guarantee, tested without a database.
 *
 * These rules are the reason people will file a report at all, so they are
 * tested exhaustively rather than sampled: what blocks publication, what only
 * warns, and — as importantly — what must NOT trigger, because a check that
 * fires on ordinary engineering prose gets switched off within a week.
 */

const DIRECTORY: DirectoryPerson[] = [
  { name: "Jordan Pace", email: "jordan.pace@example.test", employeeId: "FSW-1042" },
  { name: "Casey Lund", email: "casey.lund@example.test", employeeId: "FSW-1043" },
  { name: "Kim Harlow", email: null, employeeId: null },
  { name: "Mark Reyes", email: null, employeeId: null },
  { name: "Bo Ng", email: null, employeeId: null },
];

function scan(text: string, field = "whatHappened") {
  return findIdentifiers([{ field, text }], DIRECTORY);
}

describe("findIdentifiers — identifying detail blocks publication", () => {
  it("blocks a colleague's full name and names the role instead", () => {
    const findings = scan("Jordan Pace quoted the wrong pressure class.");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "FULL_NAME", match: "Jordan Pace", blocking: true });
    expect(findings[0]?.advice).toMatch(/role, not the person/i);
    expect(hasBlockingIdentifiers(findings)).toBe(true);
  });

  it("matches a full name across a middle name or initial", () => {
    expect(scan("Jordan T Pace signed it off.")[0]).toMatchObject({
      kind: "FULL_NAME",
      match: "Jordan T Pace",
    });
    expect(scan("Jordan Taylor Pace signed it off.")[0]).toMatchObject({ kind: "FULL_NAME" });
  });

  it("matches a name regardless of case, possessive form, or accents", () => {
    expect(scan("JORDAN PACE approved it.")[0]?.kind).toBe("FULL_NAME");
    expect(scan("It was Jordan Pace's quote.")[0]?.kind).toBe("FULL_NAME");
    expect(findIdentifiers([{ field: "f", text: "Jose Alvarez checked it." }], [
      { name: "José Álvarez" },
    ])[0]?.kind).toBe("FULL_NAME");
  });

  it("reports each named person once, however often they appear", () => {
    const findings = scan("Jordan Pace called Casey Lund, then Jordan Pace called again.");
    const fullNames = findings.filter((f) => f.kind === "FULL_NAME");
    expect(fullNames).toHaveLength(2);
    expect(fullNames.map((f) => f.match).sort()).toEqual(["Casey Lund", "Jordan Pace"]);
  });

  it("blocks any email address, internal or external", () => {
    const internal = scan("Escalated to jordan.pace@example.test for a decision.");
    expect(internal[0]).toMatchObject({ kind: "EMAIL", blocking: true });
    expect(internal[0]?.advice).toMatch(/describe the role/i);

    const external = scan("The supplier replied from sales@valveco.example.");
    expect(external[0]).toMatchObject({ kind: "EMAIL", blocking: true });
    expect(external[0]?.advice).toMatch(/external contact/i);
  });

  it("blocks a punctuated or internationally prefixed phone number", () => {
    for (const text of [
      "Called them back on (713) 555-0142 to confirm.",
      "Called them back on 713-555-0142 to confirm.",
      "Called them back on 713.555.0142 to confirm.",
      "Reached the driver on +1 713 555 0142.",
      "Reached the driver on +17135550142.",
    ]) {
      const findings = scan(text).filter((f) => f.kind === "PHONE");
      expect(findings.length, text).toBeGreaterThan(0);
      expect(findings.some((f) => f.blocking), text).toBe(true);
    }
  });

  it("only warns on a bare ten-digit run, which is as likely to be a part number", () => {
    const findings = scan("Cross-referenced against 7135550142 in the catalog.");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "PHONE", blocking: false });
    expect(hasBlockingIdentifiers(findings)).toBe(false);
  });

  it("never finds a phone number inside a longer digit run", () => {
    /*
     * Without the digit fences, any long identifier contains a ten-digit
     * substring — a 13-digit timestamp read as a phone number, which is how
     * this was found.
     */
    for (const text of [
      "Logged at 1756672345678 in the audit trail.",
      "Serial 000071355501420001 on the nameplate.",
      "Rated to 1042 psi at 100 F.",
      "Part V-2201 sits next to V-2210.",
    ]) {
      expect(scan(text).filter((f) => f.kind === "PHONE"), text).toEqual([]);
    }
  });

  it("blocks an employee number, including a digit-bearing one", () => {
    const findings = scan("Raised against FSW-1042 in the HR system.");
    expect(findings.some((f) => f.kind === "EMPLOYEE_ID" && f.blocking)).toBe(true);
  });

  it("does not treat an unrelated number as an employee id", () => {
    expect(scan("Rated to 1042 psi, not 740.").filter((f) => f.kind === "EMPLOYEE_ID")).toEqual([]);
  });

  it("ignores a directory entry with a single-token name", () => {
    // "Bo Ng" is two tokens; a mononym would give no first/last pair to match.
    const findings = findIdentifiers([{ field: "f", text: "Prince approved it." }], [
      { name: "Prince" },
    ]);
    expect(findings).toEqual([]);
  });
});

describe("findIdentifiers — blame language warns but does not block", () => {
  const blameSamples: [string, RegExp][] = [
    ["It was his fault the wrong item shipped.", /condition that allowed it/i],
    ["The picker was at fault.", /at fault/i],
    ["Nobody was to blame for the delay.", /causes, not blame/i],
    ["A careless transcription of the model number.", /judgment/i],
    ["That was a sloppy handover.", /judgment/i],
    ["They should have known the class was wrong.", /not available at the time/i],
    ["They didn't bother to check the datasheet.", /easy to skip/i],
    ["The team failed to pay attention to the revision.", /symptom, not a cause/i],
    ["The step was deliberately skipped to save time.", /impractical/i],
  ];

  for (const [text, adviceMatch] of blameSamples) {
    it(`warns on: ${text}`, () => {
      const findings = scan(text).filter((f) => f.kind === "BLAME");
      expect(findings).toHaveLength(1);
      expect(findings[0]?.blocking).toBe(false);
      expect(findings[0]?.advice).toMatch(adviceMatch);
    });
  }

  it("a blame warning alone never blocks publication", () => {
    const findings = scan("A careless transcription of the model number.");
    expect(findings.length).toBeGreaterThan(0);
    expect(hasBlockingIdentifiers(findings)).toBe(false);
  });
});

describe("findIdentifiers — a lone first name warns", () => {
  it("warns without blocking", () => {
    const findings = scan("Kim spotted it during the second check.");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "FIRST_NAME", match: "Kim", blocking: false });
    expect(hasBlockingIdentifiers(findings)).toBe(false);
  });

  it("stays quiet for first names that read as ordinary words", () => {
    // "Mark" is in the ambiguous list: "mark the drum" must not warn.
    expect(scan("Mark the drum before it leaves the dock.")).toEqual([]);
  });

  it("stays quiet for a two-letter first name", () => {
    expect(scan("Bo is a valve size, not a person here.").filter((f) => f.kind === "FIRST_NAME")).toEqual([]);
  });
});

describe("findIdentifiers — ordinary engineering prose triggers nothing", () => {
  const clean = [
    "A 150# flange was picked for a 300# service. The mismatch was caught at the packing bench because the gasket would not seat.",
    "The customer asked for a same-day promise the warehouse could not meet; the commitment was made before stock was checked.",
    "Two part numbers differ by a single character (V-2201 and V-2210) and sit next to each other on the shelf.",
    "The quoting engineer used a superseded datasheet; the revision date was not shown on the printout.",
    "Rated to 740 psi at 100 F, which is below the 1042 psi the line sees on start-up.",
  ];

  for (const text of clean) {
    it(`is silent on: ${text.slice(0, 48)}…`, () => {
      expect(findIdentifiers([{ field: "whatHappened", text }], DIRECTORY)).toEqual([]);
    });
  }

  it("is silent on empty, whitespace and absent text", () => {
    expect(
      findIdentifiers(
        [
          { field: "a", text: "" },
          { field: "b", text: "   " },
          { field: "c", text: null },
          { field: "d", text: undefined },
        ],
        DIRECTORY,
      ),
    ).toEqual([]);
  });

  it("is silent when the directory is empty and the text has no contact details", () => {
    expect(findIdentifiers([{ field: "a", text: "Jordan Pace quoted it." }], [])).toEqual([]);
  });
});

describe("findIdentifiers — reporting shape", () => {
  it("attributes each finding to the field it came from", () => {
    const findings = findIdentifiers(
      [
        { field: "whatHappened", text: "Jordan Pace quoted it." },
        { field: "whyItHappened", text: "It was his fault." },
      ],
      DIRECTORY,
    );
    expect(findings.find((f) => f.kind === "FULL_NAME")?.field).toBe("whatHappened");
    expect(findings.find((f) => f.kind === "BLAME")?.field).toBe("whyItHappened");
  });

  it("orders blocking findings before warnings", () => {
    const findings = findIdentifiers(
      [{ field: "whatHappened", text: "Kim was careless. Jordan Pace fixed it." }],
      DIRECTORY,
    );
    const firstWarningAt = findings.findIndex((f) => !f.blocking);
    const lastBlockingAt = findings.map((f) => f.blocking).lastIndexOf(true);
    expect(firstWarningAt).toBeGreaterThan(lastBlockingAt);
  });

  it("summarizes only the blocking findings, pluralized", () => {
    const one = findIdentifiers([{ field: "f", text: "Jordan Pace did it." }], DIRECTORY);
    expect(summarizeBlocking(one)).toBe("1 person's name");

    const two = findIdentifiers(
      [{ field: "f", text: "Jordan Pace and Casey Lund were there." }],
      DIRECTORY,
    );
    expect(summarizeBlocking(two)).toBe("2 person's names");

    const mixed = findIdentifiers(
      [{ field: "f", text: "Jordan Pace, jordan.pace@example.test, was careless." }],
      DIRECTORY,
    );
    expect(summarizeBlocking(mixed)).toMatch(/email address/);
    expect(summarizeBlocking(mixed)).not.toMatch(/blame/);

    expect(summarizeBlocking([])).toBe("");
    expect(summarizeBlocking(scan("A careless note."))).toBe("");
  });
});
