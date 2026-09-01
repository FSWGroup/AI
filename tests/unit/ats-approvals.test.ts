import { describe, it, expect } from "vitest";
import { canDecide, chainStatus, describeChain, type ApprovalStep } from "@/lib/ats/approvals";

function step(over: Partial<ApprovalStep>): ApprovalStep {
  return {
    stepIndex: 0,
    approverId: "u1",
    approverName: "Ana",
    decision: "PENDING",
    comment: null,
    decidedAt: null,
    ...over,
  };
}

describe("chainStatus", () => {
  it("reports an empty chain as not started", () => {
    expect(chainStatus([]).state).toBe("NOT_STARTED");
  });

  it("waits on the first pending step, in order", () => {
    const status = chainStatus([
      step({ stepIndex: 1, approverId: "u2", approverName: "Ben" }),
      step({ stepIndex: 0, decision: "APPROVED" }),
    ]);
    expect(status.state).toBe("IN_PROGRESS");
    expect(status.currentStep?.approverName).toBe("Ben");
    expect(status.approvedCount).toBe(1);
  });

  it("is approved only when every step has approved", () => {
    expect(
      chainStatus([
        step({ stepIndex: 0, decision: "APPROVED" }),
        step({ stepIndex: 1, approverId: "u2", decision: "APPROVED" }),
      ]).state,
    ).toBe("APPROVED");
  });

  it("stops at a rejection regardless of later steps", () => {
    const status = chainStatus([
      step({ stepIndex: 0, decision: "APPROVED" }),
      step({ stepIndex: 1, approverId: "u2", approverName: "Ben", decision: "REJECTED" }),
      step({ stepIndex: 2, approverId: "u3", decision: "PENDING" }),
    ]);
    expect(status.state).toBe("REJECTED");
    expect(status.rejectedBy?.approverName).toBe("Ben");
    expect(status.currentStep).toBeNull();
  });

  it("treats a skipped step as not blocking", () => {
    expect(
      chainStatus([
        step({ stepIndex: 0, decision: "SKIPPED" }),
        step({ stepIndex: 1, approverId: "u2", decision: "APPROVED" }),
      ]).state,
    ).toBe("APPROVED");
  });
});

describe("canDecide", () => {
  const steps = [
    step({ stepIndex: 0, decision: "APPROVED" }),
    step({ stepIndex: 1, approverId: "u2", approverName: "Ben" }),
    step({ stepIndex: 2, approverId: "u3", approverName: "Cara" }),
  ];

  it("lets the current approver decide", () => {
    expect(canDecide(steps, "u2").allowed).toBe(true);
  });

  it("does not let a later approver pre-approve", () => {
    const check = canDecide(steps, "u3");
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("Ben");
  });

  it("does not let an approver decide twice", () => {
    expect(canDecide(steps, "u1").allowed).toBe(false);
  });

  it("refuses once the chain is settled", () => {
    expect(canDecide([step({ decision: "APPROVED" })], "u1").allowed).toBe(false);
    expect(canDecide([step({ decision: "REJECTED" })], "u1").allowed).toBe(false);
  });
});

describe("describeChain", () => {
  it("names who it is waiting on", () => {
    expect(
      describeChain([
        step({ stepIndex: 0, decision: "APPROVED" }),
        step({ stepIndex: 1, approverId: "u2", approverName: "Ben" }),
      ]),
    ).toContain("waiting on Ben");
  });
});
