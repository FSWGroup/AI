/**
 * Numerical Perception bank — algorithmically generated comparison items.
 *
 * This construct measures how quickly and accurately a person spots
 * differences or similarities among numbers, part numbers, prices,
 * quantities, and alphanumeric strings (SKUs, order numbers) — directly
 * relevant to technical distribution work.
 *
 * Content is original numeric/alphanumeric material generated with a FIXED
 * seed, so the bank is deterministic: every seed run produces the same
 * items, and item identity is stable across environments.
 */

export interface NumericalPerceptionItem {
  subtype: "same_different" | "match_target" | "odd_one_out";
  difficulty: 1 | 2 | 3;
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
}

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x46535721); // "FSW!" — fixed seed, do not change.

function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

const LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";
const DIGITS = "0123456789";

/** Character substitutions that are easy to misread. */
const CONFUSABLE: Record<string, string[]> = {
  "0": ["8", "6", "9"],
  "1": ["7", "4"],
  "2": ["5", "7"],
  "3": ["8", "5"],
  "5": ["6", "3", "2"],
  "6": ["8", "5", "0"],
  "8": ["3", "0", "6"],
  "9": ["4", "0"],
  B: ["R", "P", "D"],
  D: ["B", "P"],
  E: ["F"],
  F: ["E", "P"],
  M: ["N", "W"],
  N: ["M", "H"],
  V: ["W", "U", "Y"],
  U: ["V"],
  C: ["G"],
  G: ["C"],
  K: ["X"],
};

function randomString(len: number, style: "digits" | "alnum" | "part"): string {
  let out = "";
  if (style === "part") {
    // e.g. "VLV-4827-XN" style part numbers
    const p1len = randInt(2, 3);
    for (let i = 0; i < p1len; i++) out += LETTERS[randInt(0, LETTERS.length - 1)];
    out += "-";
    const p2len = randInt(3, 5);
    for (let i = 0; i < p2len; i++) out += DIGITS[randInt(0, DIGITS.length - 1)];
    out += "-";
    const p3len = randInt(1, 2);
    for (let i = 0; i < p3len; i++) out += LETTERS[randInt(0, LETTERS.length - 1)];
    return out;
  }
  const pool = style === "digits" ? DIGITS : LETTERS + DIGITS;
  for (let i = 0; i < len; i++) out += pool[randInt(0, pool.length - 1)];
  return out;
}

/** Mutate one string subtly: substitution, transposition, or duplication. */
function mutate(s: string, subtle: boolean): string {
  const chars = s.split("");
  const editableIdx = chars
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c !== "-" && c !== ".");
  const target = editableIdx[randInt(0, editableIdx.length - 1)];
  const kind = pick(["substitute", "transpose", "substitute"] as const);

  if (kind === "transpose" && target.i < chars.length - 1 && chars[target.i + 1] !== "-") {
    const tmp = chars[target.i];
    chars[target.i] = chars[target.i + 1];
    chars[target.i + 1] = tmp;
    const out = chars.join("");
    if (out !== s) return out;
  }

  // Substitution — confusable char if subtle, any different char otherwise.
  const original = chars[target.i];
  let replacement: string;
  if (subtle && CONFUSABLE[original]) {
    replacement = pick(CONFUSABLE[original]);
  } else {
    const pool = /[0-9]/.test(original) ? DIGITS : LETTERS;
    do {
      replacement = pool[randInt(0, pool.length - 1)];
    } while (replacement === original);
  }
  chars[target.i] = replacement;
  return chars.join("");
}

function priceString(): string {
  const dollars = randInt(3, 24999);
  const cents = randInt(0, 99);
  return `$${dollars.toLocaleString("en-US")}.${String(cents).padStart(2, "0")}`;
}

function mutatePrice(p: string): string {
  // Change one digit, keeping format identical.
  const chars = p.split("");
  const digitIdx = chars
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => /[0-9]/.test(c));
  const t = digitIdx[randInt(0, digitIdx.length - 1)];
  let replacement: string;
  do {
    replacement = DIGITS[randInt(0, 9)];
  } while (replacement === t.c);
  chars[t.i] = replacement;
  return chars.join("");
}

function generate(): NumericalPerceptionItem[] {
  const items: NumericalPerceptionItem[] = [];

  // --- Family 1: same/different pairs (120 items) ---
  const pairStyles = [
    { style: "digits" as const, lenRange: [6, 8] as const, difficulty: 1 as const },
    { style: "part" as const, lenRange: [0, 0] as const, difficulty: 2 as const },
    { style: "alnum" as const, lenRange: [8, 10] as const, difficulty: 2 as const },
    { style: "alnum" as const, lenRange: [11, 14] as const, difficulty: 3 as const },
  ];
  for (let i = 0; i < 100; i++) {
    const cfg = pairStyles[i % pairStyles.length];
    const a =
      cfg.style === "part"
        ? randomString(0, "part")
        : randomString(randInt(cfg.lenRange[0], cfg.lenRange[1]), cfg.style);
    const identical = rand() < 0.5;
    const subtle = cfg.difficulty >= 2;
    const b = identical ? a : mutate(a, subtle);
    items.push({
      subtype: "same_different",
      difficulty: cfg.difficulty,
      prompt: `Are these two entries identical?\n\n${a}\n${b}`,
      choices: ["Identical", "Different"],
      correctIndex: identical ? 0 : 1,
      explanation: identical
        ? "The two entries match character for character."
        : `The entries differ: "${a}" vs "${b}".`,
    });
  }
  // Price pairs (20 items).
  for (let i = 0; i < 20; i++) {
    const a = priceString();
    const identical = rand() < 0.5;
    const b = identical ? a : mutatePrice(a);
    items.push({
      subtype: "same_different",
      difficulty: i < 10 ? 1 : 2,
      prompt: `Are these two prices identical?\n\n${a}\n${b}`,
      choices: ["Identical", "Different"],
      correctIndex: identical ? 0 : 1,
      explanation: identical
        ? "The two prices match exactly."
        : `The prices differ: "${a}" vs "${b}".`,
    });
  }

  // --- Family 2: match the target (70 items) ---
  for (let i = 0; i < 70; i++) {
    const difficulty = (i < 20 ? 1 : i < 48 ? 2 : 3) as 1 | 2 | 3;
    const style = pick(["part", "alnum", "digits"] as const);
    const target =
      style === "part"
        ? randomString(0, "part")
        : randomString(difficulty === 3 ? randInt(10, 13) : randInt(7, 9), style);
    const correctPos = randInt(0, 3);
    const choices: string[] = [];
    const used = new Set<string>([target]);
    for (let c = 0; c < 4; c++) {
      if (c === correctPos) {
        choices.push(target);
      } else {
        let distractor = mutate(target, difficulty >= 2);
        while (used.has(distractor)) distractor = mutate(target, difficulty >= 2);
        used.add(distractor);
        choices.push(distractor);
      }
    }
    items.push({
      subtype: "match_target",
      difficulty,
      prompt: `Which option is identical to this entry?\n\n${target}`,
      choices,
      correctIndex: correctPos,
      explanation: `Only option ${correctPos + 1} matches "${target}" exactly.`,
    });
  }

  // --- Family 3: odd one out (30 items) ---
  for (let i = 0; i < 30; i++) {
    const difficulty = (i < 10 ? 1 : i < 22 ? 2 : 3) as 1 | 2 | 3;
    const style = pick(["part", "alnum"] as const);
    const base =
      style === "part"
        ? randomString(0, "part")
        : randomString(difficulty === 3 ? randInt(10, 12) : randInt(7, 9), "alnum");
    const oddPos = randInt(0, 3);
    let odd = mutate(base, difficulty >= 2);
    while (odd === base) odd = mutate(base, difficulty >= 2);
    const choices = [base, base, base, base];
    choices[oddPos] = odd;
    items.push({
      subtype: "odd_one_out",
      difficulty,
      prompt: "Three of these entries are identical. Which one is different?",
      choices,
      correctIndex: oddPos,
      explanation: `Option ${oddPos + 1} ("${odd}") differs from the other three ("${base}").`,
    });
  }

  return items;
}

export const numericalPerceptionBank: {
  construct: "NUMERICAL_PERCEPTION";
  items: NumericalPerceptionItem[];
} = {
  construct: "NUMERICAL_PERCEPTION",
  items: generate(),
};
