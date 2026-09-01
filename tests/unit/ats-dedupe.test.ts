import { describe, it, expect } from "vitest";
import {
  findDuplicates,
  normalizeEmail,
  normalizePhone,
  normalizeName,
  editDistance,
  type CandidateIdentity,
} from "@/lib/ats/dedupe";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Maria.Santos@Example.COM ")).toBe("maria.santos@example.com");
  });
  it("strips plus-tags on any host", () => {
    expect(normalizeEmail("maria+jobs@example.com")).toBe("maria@example.com");
  });
  it("ignores dots only on Gmail, where they are actually insignificant", () => {
    expect(normalizeEmail("maria.santos@gmail.com")).toBe("mariasantos@gmail.com");
    expect(normalizeEmail("maria.santos@example.com")).toBe("maria.santos@example.com");
  });
  it("leaves a malformed address alone rather than mangling it", () => {
    expect(normalizeEmail("not-an-email")).toBe("not-an-email");
  });
});

describe("normalizePhone", () => {
  it("matches the same Philippine mobile written three ways", () => {
    const a = normalizePhone("0917 123 4567");
    expect(normalizePhone("+63 917 123 4567")).toBe(a);
    expect(normalizePhone("639171234567")).toBe(a);
  });
  it("returns null for something too short to identify anyone", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("normalizeName", () => {
  it("strips accents, case, and punctuation", () => {
    expect(normalizeName("José  O'Brien-Smith")).toBe("jose obrien-smith");
  });
});

describe("editDistance", () => {
  it("counts single-character changes", () => {
    expect(editDistance("maria", "marla")).toBe(1);
    expect(editDistance("maria", "maria")).toBe(0);
    expect(editDistance("", "abc")).toBe(3);
  });
});

describe("findDuplicates", () => {
  const existing: CandidateIdentity[] = [
    {
      id: "c1",
      firstName: "Maria",
      lastName: "Santos",
      email: "maria.santos@gmail.com",
      phone: "+63 917 123 4567",
    },
    {
      id: "c2",
      firstName: "Juan",
      lastName: "Dela Cruz",
      email: "juan@example.com",
      phone: null,
    },
  ];

  it("calls the same normalized email an exact match", () => {
    const matches = findDuplicates(
      {
        firstName: "M",
        lastName: "Santos",
        email: "mariasantos+indeed@gmail.com",
        phone: null,
      },
      existing,
    );
    expect(matches[0]).toMatchObject({ candidateId: "c1", strength: "EXACT" });
  });

  it("calls a shared phone with a matching name a strong match", () => {
    const matches = findDuplicates(
      {
        firstName: "Maria",
        lastName: "Santos",
        email: "different@work.com",
        phone: "09171234567",
      },
      existing,
    );
    expect(matches[0]).toMatchObject({ candidateId: "c1", strength: "STRONG" });
    expect(matches[0].reasons).toContain("Same phone number");
  });

  it("calls a similar name alone only a possible match", () => {
    const matches = findDuplicates(
      { firstName: "Marla", lastName: "Santos", email: "x@y.com", phone: null },
      existing,
    );
    expect(matches[0]).toMatchObject({ candidateId: "c1", strength: "POSSIBLE" });
  });

  it("does not match two different people who share nothing", () => {
    expect(
      findDuplicates(
        { firstName: "Ana", lastName: "Reyes", email: "ana@x.com", phone: null },
        existing,
      ),
    ).toEqual([]);
  });

  it("does not flag a shared surname with a different short given name", () => {
    // "Ana Cruz", "Ann Cruz" and "Bea Cruz" are all plausibly different
    // people. With no shared contact detail there is nothing to go on, and a
    // suggestion the reviewer will always dismiss is worse than none.
    const shortNames: CandidateIdentity[] = [
      { id: "s1", firstName: "Ana", lastName: "Cruz", email: "a@x.com", phone: null },
    ];
    for (const firstName of ["Ann", "Bea", "Rey"]) {
      expect(
        findDuplicates(
          { firstName, lastName: "Cruz", email: "b@x.com", phone: null },
          shortNames,
        ),
      ).toEqual([]);
    }
  });

  it("tolerates a shortened or initialed given name", () => {
    const pool: CandidateIdentity[] = [
      {
        id: "r1",
        firstName: "Roberto",
        lastName: "Villanueva",
        email: "roberto@x.com",
        phone: null,
      },
    ];
    for (const firstName of ["Rob", "R", "Roberto"]) {
      expect(
        findDuplicates(
          { firstName, lastName: "Villanueva", email: "other@x.com", phone: null },
          pool,
        ).map((m) => m.strength),
      ).toEqual(["POSSIBLE"]);
    }
  });

  it("does not let a long surname pay for a wrong given name", () => {
    const pool: CandidateIdentity[] = [
      {
        id: "v1",
        firstName: "Ana",
        lastName: "Villanueva",
        email: "ana@x.com",
        phone: null,
      },
    ];
    expect(
      findDuplicates(
        { firstName: "Bea", lastName: "Villanueva", email: "bea@x.com", phone: null },
        pool,
      ),
    ).toEqual([]);
  });

  it("orders exact matches ahead of weaker ones", () => {
    const pool: CandidateIdentity[] = [
      { id: "weak", firstName: "Maria", lastName: "Santoz", email: "z@x.com", phone: null },
      ...existing,
    ];
    const matches = findDuplicates(
      { firstName: "Maria", lastName: "Santos", email: "maria.santos@gmail.com", phone: null },
      pool,
    );
    expect(matches[0].strength).toBe("EXACT");
  });
});
