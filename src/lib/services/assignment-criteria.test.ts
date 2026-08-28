import { describe, it, expect } from "vitest";
import { evaluateCriteria, type UserContext } from "@/lib/services/criteria";

/**
 * The assignment rule engine decides who is required to complete what. A wrong
 * answer here either withholds mandatory training or assigns it to the wrong
 * people, so the evaluator is tested exhaustively.
 *
 * `evaluateCriteria` is pure, so this needs no database.
 */

function context(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: "user_1",
    workerType: "US_EMPLOYEE",
    country: "US",
    state: "NC",
    status: "ACTIVE",
    departmentId: "dept_sales",
    departmentName: "Sales",
    teamId: "team_inside",
    teamName: "Inside Sales",
    businessUnitId: "bu_welsford",
    businessUnitSlug: "welsford",
    businessUnitName: "Welsford",
    positionId: "pos_inside_sales",
    positionTitle: "Inside Sales Representative",
    locationId: "loc_hq",
    locationName: "Headquarters",
    managerId: "user_manager",
    managerName: "Tom Rivera",
    roleKeys: ["learner"],
    hireDaysAgo: 30,
    startDate: "2026-07-29",
    ...overrides,
  };
}

describe("single conditions", () => {
  it("matches eq on a string field", () => {
    expect(
      evaluateCriteria({ field: "workerType", op: "eq", value: "US_EMPLOYEE" }, context()),
    ).toBe(true);
    expect(
      evaluateCriteria({ field: "workerType", op: "eq", value: "PH_CONTRACTOR" }, context()),
    ).toBe(false);
  });

  it("matches neq", () => {
    expect(evaluateCriteria({ field: "country", op: "neq", value: "PH" }, context())).toBe(true);
    expect(evaluateCriteria({ field: "country", op: "neq", value: "US" }, context())).toBe(false);
  });

  it("matches in and nin against a list", () => {
    expect(
      evaluateCriteria({ field: "country", op: "in", value: ["US", "PH"] }, context()),
    ).toBe(true);
    expect(
      evaluateCriteria({ field: "country", op: "in", value: ["CA", "MX"] }, context()),
    ).toBe(false);
    expect(
      evaluateCriteria({ field: "country", op: "nin", value: ["CA", "MX"] }, context()),
    ).toBe(true);
    expect(
      evaluateCriteria({ field: "country", op: "nin", value: ["US"] }, context()),
    ).toBe(false);
  });

  it("compares numbers with gt, gte, lt, and lte", () => {
    const ctx = context({ hireDaysAgo: 30 });
    expect(evaluateCriteria({ field: "hireDaysAgo", op: "gt", value: 29 }, ctx)).toBe(true);
    expect(evaluateCriteria({ field: "hireDaysAgo", op: "gt", value: 30 }, ctx)).toBe(false);
    expect(evaluateCriteria({ field: "hireDaysAgo", op: "gte", value: 30 }, ctx)).toBe(true);
    expect(evaluateCriteria({ field: "hireDaysAgo", op: "lt", value: 31 }, ctx)).toBe(true);
    expect(evaluateCriteria({ field: "hireDaysAgo", op: "lte", value: 30 }, ctx)).toBe(true);
    expect(evaluateCriteria({ field: "hireDaysAgo", op: "lt", value: 30 }, ctx)).toBe(false);
  });

  it("matches contains on a string field", () => {
    expect(
      evaluateCriteria({ field: "positionTitle", op: "contains", value: "Sales" }, context()),
    ).toBe(true);
    expect(
      evaluateCriteria({ field: "positionTitle", op: "contains", value: "Warehouse" }, context()),
    ).toBe(false);
  });

  it("matches roleKey against the held role list", () => {
    const ctx = context({ roleKeys: ["learner", "manager"] });
    expect(evaluateCriteria({ field: "roleKey", op: "eq", value: "manager" }, ctx)).toBe(true);
    expect(evaluateCriteria({ field: "roleKey", op: "eq", value: "hr_admin" }, ctx)).toBe(false);
    expect(
      evaluateCriteria({ field: "roleKey", op: "in", value: ["hr_admin", "manager"] }, ctx),
    ).toBe(true);
  });

  it("tests presence with exists", () => {
    expect(evaluateCriteria({ field: "managerId", op: "exists" }, context())).toBe(true);
    expect(
      evaluateCriteria({ field: "managerId", op: "exists" }, context({ managerId: null })),
    ).toBe(false);
  });
});

describe("null handling", () => {
  it("does not match eq against a null field", () => {
    expect(
      evaluateCriteria({ field: "state", op: "eq", value: "NC" }, context({ state: null })),
    ).toBe(false);
  });

  it("does not silently pass a numeric comparison when the value is null", () => {
    const ctx = context({ hireDaysAgo: null });
    expect(evaluateCriteria({ field: "hireDaysAgo", op: "gt", value: 0 }, ctx)).toBe(false);
    expect(evaluateCriteria({ field: "hireDaysAgo", op: "lt", value: 9999 }, ctx)).toBe(false);
  });

  it("treats a null field as not-in for in, and satisfies nin", () => {
    const ctx = context({ departmentName: null });
    expect(
      evaluateCriteria({ field: "departmentName", op: "in", value: ["Sales"] }, ctx),
    ).toBe(false);
    expect(
      evaluateCriteria({ field: "departmentName", op: "nin", value: ["Sales"] }, ctx),
    ).toBe(true);
  });
});

describe("combinators", () => {
  it("requires every condition under all", () => {
    const criteria = {
      all: [
        { field: "workerType", op: "eq", value: "US_EMPLOYEE" },
        { field: "departmentName", op: "eq", value: "Sales" },
      ],
    };
    expect(evaluateCriteria(criteria, context())).toBe(true);
    expect(evaluateCriteria(criteria, context({ departmentName: "Operations" }))).toBe(false);
  });

  it("requires at least one condition under any", () => {
    const criteria = {
      any: [
        { field: "departmentName", op: "eq", value: "Operations" },
        { field: "departmentName", op: "eq", value: "Sales" },
      ],
    };
    expect(evaluateCriteria(criteria, context())).toBe(true);
    expect(evaluateCriteria(criteria, context({ departmentName: "Accounting" }))).toBe(false);
  });

  it("inverts under not", () => {
    const criteria = { not: { field: "country", op: "eq", value: "PH" } };
    expect(evaluateCriteria(criteria, context())).toBe(true);
    expect(evaluateCriteria(criteria, context({ country: "PH" }))).toBe(false);
  });

  it("nests combinators to arbitrary depth", () => {
    // US employees in Sales, OR anyone in the Philippines who is a contractor.
    const criteria = {
      any: [
        {
          all: [
            { field: "country", op: "eq", value: "US" },
            { field: "workerType", op: "eq", value: "US_EMPLOYEE" },
            { field: "departmentName", op: "eq", value: "Sales" },
          ],
        },
        {
          all: [
            { field: "country", op: "eq", value: "PH" },
            { field: "workerType", op: "eq", value: "PH_CONTRACTOR" },
          ],
        },
      ],
    };

    expect(evaluateCriteria(criteria, context())).toBe(true);
    expect(
      evaluateCriteria(
        criteria,
        context({ country: "PH", workerType: "PH_CONTRACTOR", departmentName: "E-commerce" }),
      ),
    ).toBe(true);
    // A Philippines employee (not contractor) matches neither branch.
    expect(
      evaluateCriteria(
        criteria,
        context({ country: "PH", workerType: "PH_EMPLOYEE", departmentName: "E-commerce" }),
      ),
    ).toBe(false);
    // A US employee outside Sales matches neither branch.
    expect(evaluateCriteria(criteria, context({ departmentName: "Accounting" }))).toBe(false);
  });

  it("combines not with all for exclusion rules", () => {
    // Everyone active except contractors.
    const criteria = {
      all: [
        { field: "status", op: "eq", value: "ACTIVE" },
        { not: { field: "workerType", op: "in", value: ["US_CONTRACTOR", "PH_CONTRACTOR"] } },
      ],
    };
    expect(evaluateCriteria(criteria, context())).toBe(true);
    expect(evaluateCriteria(criteria, context({ workerType: "US_CONTRACTOR" }))).toBe(false);
    expect(evaluateCriteria(criteria, context({ status: "INACTIVE" }))).toBe(false);
  });
});

describe("the seeded rules behave as intended", () => {
  const allActive = { all: [{ field: "status", op: "eq", value: "ACTIVE" }] };

  const salesDepartment = {
    all: [
      { field: "departmentName", op: "eq", value: "Sales" },
      { field: "status", op: "eq", value: "ACTIVE" },
    ],
  };

  const philippinesContractors = {
    all: [
      { field: "country", op: "eq", value: "PH" },
      { field: "workerType", op: "eq", value: "PH_CONTRACTOR" },
    ],
  };

  it("assigns cybersecurity training to every active person", () => {
    expect(evaluateCriteria(allActive, context())).toBe(true);
    expect(evaluateCriteria(allActive, context({ workerType: "PH_CONTRACTOR", country: "PH" }))).toBe(
      true,
    );
    expect(evaluateCriteria(allActive, context({ status: "INACTIVE" }))).toBe(false);
  });

  it("assigns the quoting course only to Sales", () => {
    expect(evaluateCriteria(salesDepartment, context())).toBe(true);
    expect(evaluateCriteria(salesDepartment, context({ departmentName: "Operations" }))).toBe(false);
  });

  it("assigns Philippines contractor onboarding narrowly", () => {
    expect(
      evaluateCriteria(
        philippinesContractors,
        context({ country: "PH", workerType: "PH_CONTRACTOR" }),
      ),
    ).toBe(true);
    // A Philippines employee is not a contractor.
    expect(
      evaluateCriteria(
        philippinesContractors,
        context({ country: "PH", workerType: "PH_EMPLOYEE" }),
      ),
    ).toBe(false);
    // A US contractor is not in the Philippines.
    expect(
      evaluateCriteria(
        philippinesContractors,
        context({ country: "US", workerType: "US_CONTRACTOR" }),
      ),
    ).toBe(false);
  });
});

describe("malformed criteria fail closed", () => {
  it("does not match on null or undefined criteria", () => {
    expect(evaluateCriteria(null, context())).toBe(false);
    expect(evaluateCriteria(undefined, context())).toBe(false);
  });

  it("does not match on a non-object", () => {
    expect(evaluateCriteria("everyone", context())).toBe(false);
    expect(evaluateCriteria(42, context())).toBe(false);
    expect(evaluateCriteria(true, context())).toBe(false);
  });

  it("does not match on an unknown field", () => {
    expect(
      evaluateCriteria({ field: "favouriteColour", op: "eq", value: "navy" }, context()),
    ).toBe(false);
  });

  it("does not match on an unknown operator", () => {
    expect(
      evaluateCriteria({ field: "country", op: "regex", value: "^US$" }, context()),
    ).toBe(false);
  });

  it("does not match an empty condition object", () => {
    expect(evaluateCriteria({}, context())).toBe(false);
  });

  it("handles an empty all as vacuously true and an empty any as false", () => {
    // `all: []` places no restriction, which is the standard reading and lets a
    // rule target everyone. `any: []` offers no way to match.
    expect(evaluateCriteria({ all: [] }, context())).toBe(true);
    expect(evaluateCriteria({ any: [] }, context())).toBe(false);
  });

  it("does not throw on deeply malformed nesting", () => {
    expect(() =>
      evaluateCriteria({ all: [{ any: [{ not: { field: "country" } }] }] }, context()),
    ).not.toThrow();
  });
});
