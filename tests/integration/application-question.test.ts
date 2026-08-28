import { describe, expect, it, beforeEach } from "vitest";
import { actorFor, createPublishedCourse, createUser, freshDatabase, testPrisma } from "./helpers";
import { startAttempt, submitAttempt, getAttemptReview } from "@/lib/services/assessment";
import { ROLE_KEYS } from "@/lib/permissions";

/**
 * Application judgment questions, end to end through the services.
 *
 * The browser test covers what only a browser can show — that the decisions
 * render as labelled groups, and that the correct answers never reach the page.
 * This covers what happens to the score, which is the part that ends up in an
 * immutable completion record: partial credit per decision, and the expert's
 * reasoning withheld until the lesson's review policy allows it.
 *
 * Submitting is tested here rather than in the browser because a failed attempt
 * starts a cooldown by design, which makes a submitting browser test
 * non-repeatable against a shared database.
 */

const APPLICATION_CONFIG = {
  parameters: [
    { label: "Service", value: "Saturated steam, isolation only" },
    { label: "Design temperature", value: "366 °F" },
  ],
  dimensions: [
    {
      id: "valve-type",
      label: "Valve type",
      weight: 2,
      options: [
        { id: "gate", label: "Gate valve" },
        { id: "globe", label: "Globe valve" },
      ],
      correctOptionId: "gate",
      reasoning: "Isolation only, so a gate valve: full bore when open.",
    },
    {
      id: "body-material",
      label: "Body material",
      weight: 2,
      options: [
        { id: "carbon-steel", label: "Carbon steel" },
        { id: "bronze", label: "Bronze" },
      ],
      correctOptionId: "carbon-steel",
      reasoning: "Carbon steel is rated for this temperature; bronze is not.",
    },
    {
      id: "end-connection",
      label: "End connection",
      options: [
        { id: "flanged", label: "Flanged, Class 150" },
        { id: "threaded", label: "Threaded NPT" },
      ],
      correctOptionId: "flanged",
      reasoning: "Class 150 flanged matches the pressure class and comes apart.",
    },
  ],
};

describe("Application question scoring", () => {
  let learnerId: string;
  let lessonId: string;
  let questionId: string;

  /** A quiz lesson holding a single APPLICATION question worth 10 points. */
  async function setup(reviewPolicy = "immediate", showExplanations = true) {
    await freshDatabase();
    const author = await createUser({ email: "author@test.dev", roles: [ROLE_KEYS.TRAINING_ADMIN] });
    learnerId = await createUser({ email: "learner@test.dev", roles: [ROLE_KEYS.LEARNER] });

    const course = await createPublishedCourse({ title: "Valve Selection", createdById: author });
    const lesson = await testPrisma.lesson.create({
      data: {
        sectionId: course.sectionId,
        title: "Selection assessment",
        type: "QUIZ",
        order: 1,
        required: true,
        content: { reviewPolicy, showExplanations },
      },
      select: { id: true },
    });
    lessonId = lesson.id;

    const question = await testPrisma.question.create({
      data: {
        lessonId,
        type: "APPLICATION",
        order: 0,
        prompt: "Make the three selections you would put on the quote.",
        config: APPLICATION_CONFIG,
        points: 10,
        explanation: "Three decisions, scored separately.",
      },
      select: { id: true },
    });
    questionId = question.id;
  }

  /** Start an attempt, answer, submit, and return the review. */
  async function answerWith(selections: Record<string, string>) {
    const actor = await actorFor(learnerId);
    const attempt = await startAttempt(actor, lessonId);
    const result = await submitAttempt(actor, attempt.id, { [questionId]: selections });
    const review = await getAttemptReview(actor, attempt.id);
    return { result, review };
  }

  beforeEach(async () => {
    await setup();
  });

  it("does not send the correct answer or the reasoning when presenting the question", async () => {
    const actor = await actorFor(learnerId);
    const attempt = await startAttempt(actor, lessonId);

    const presented = attempt.questions.find((q) => q.id === questionId);
    expect(presented).toBeDefined();

    /*
     * Asserted structurally rather than by string matching. Option ids like
     * "gate" legitimately travel to the browser — they are how a selection is
     * identified when it comes back. What must never travel is any field
     * marking one of them as the right one, or the reasoning that names it.
     */
    const presentation = presented!.presentation as {
      parameters: unknown[];
      dimensions: { id: string; label: string; options: Record<string, unknown>[] }[];
    };

    for (const dimension of presentation.dimensions) {
      // Exactly the keys needed to render and to answer, and no others.
      expect(Object.keys(dimension).sort()).toEqual(["id", "label", "options"]);
      for (const option of dimension.options) {
        expect(Object.keys(option).sort()).toEqual(["id", "label"]);
      }
    }

    const serialized = JSON.stringify(presented);
    expect(serialized).not.toContain("correctOptionId");
    expect(serialized).not.toContain("Carbon steel is rated");
    expect(serialized).not.toContain("full bore when open");
    expect(serialized).not.toContain("weight");

    // The facts and the options are there, because that is the question.
    expect(serialized).toContain("Saturated steam");
    expect(serialized).toContain("Gate valve");
  });

  it("awards full marks and reveals every reasoning when all three are right", async () => {
    const { result, review } = await answerWith({
      "valve-type": "gate",
      "body-material": "carbon-steel",
      "end-connection": "flanged",
    });

    expect(result.scorePercent).toBe(100);

    const response = review.responses[0]!;
    expect(response.isCorrect).toBe(true);
    expect(response.pointsEarned).toBe(10);
    expect(response.dimensions).toHaveLength(3);
    expect(response.dimensions!.every((d) => d.isCorrect)).toBe(true);
    expect(response.dimensions!.map((d) => d.reasoning)).not.toContain(null);
  });

  it("gives weighted partial credit and names only the decision that was wrong", async () => {
    // Valve type (weight 2) and end connection (weight 1) right, body material
    // (weight 2) wrong: 3 of 5 weight, so 6 of 10 points.
    const { result, review } = await answerWith({
      "valve-type": "gate",
      "body-material": "bronze",
      "end-connection": "flanged",
    });

    const response = review.responses[0]!;
    expect(response.pointsEarned).toBe(6);
    expect(result.scorePercent).toBe(60);
    // Partial credit is not "correct".
    expect(response.isCorrect).toBe(false);

    const material = response.dimensions!.find((d) => d.label === "Body material")!;
    expect(material.isCorrect).toBe(false);
    expect(material.chosenLabel).toBe("Bronze");
    expect(material.correctLabel).toBe("Carbon steel");
    expect(material.reasoning).toContain("Carbon steel is rated");

    const type = response.dimensions!.find((d) => d.label === "Valve type")!;
    expect(type.isCorrect).toBe(true);
    expect(type.chosenLabel).toBe("Gate valve");
  });

  it("treats a decision left blank as wrong, and says the learner chose nothing", async () => {
    const { review } = await answerWith({ "valve-type": "gate" });

    const response = review.responses[0]!;
    // Valve type carries weight 2 of 5.
    expect(response.pointsEarned).toBe(4);

    const skipped = response.dimensions!.find((d) => d.label === "End connection")!;
    expect(skipped.isCorrect).toBe(false);
    expect(skipped.chosenLabel).toBeNull();
  });

  it("withholds the answer and the reasoning while the review policy says to", async () => {
    // A lesson set to reveal only after a pass, answered badly enough to fail.
    await setup("after_pass");

    const { review } = await answerWith({
      "valve-type": "globe",
      "body-material": "bronze",
      "end-connection": "threaded",
    });

    const response = review.responses[0]!;
    // Correctness itself is withheld under this policy.
    expect(response.isCorrect).toBeNull();
    expect(response.pointsEarned).toBeNull();

    // And so is the expert's choice, which would otherwise leak through the
    // per-decision breakdown.
    for (const dimension of response.dimensions!) {
      expect(dimension.correctLabel).toBeNull();
      expect(dimension.reasoning).toBeNull();
    }
    // The learner's own selections are still shown back to them.
    expect(response.dimensions!.map((d) => d.chosenLabel)).toContain("Globe valve");
  });

  it("withholds the reasoning when the lesson hides explanations", async () => {
    await setup("immediate", false);

    const { review } = await answerWith({
      "valve-type": "gate",
      "body-material": "carbon-steel",
      "end-connection": "flanged",
    });

    const response = review.responses[0]!;
    // The score is revealed, since the policy is immediate.
    expect(response.pointsEarned).toBe(10);
    // The teaching text is not.
    for (const dimension of response.dimensions!) {
      expect(dimension.reasoning).toBeNull();
    }
  });
});
