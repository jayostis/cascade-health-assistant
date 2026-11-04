import type { UIMessage } from "ai";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { sideSaid, stepSaid, stepsOf, workingSaid, type Found } from "./steps.ts";
import { LookedAt } from "./turn.tsx";

const row = (side: "before" | "after", value: string, day: string) => ({
  entry: `e-${side}-${value}`,
  performed: `${day}T08:00:00Z`,
  value,
  unit: "mg/dL",
  side,
});

/** Creatinine 0.88 before and 1.02 after: the pair #11 found rounded to "mean 1 ... (0.9 to 1)". */
const creatinine: Found = {
  key: "creatinine-lisinopril",
  said: "Creatinine went up after lisinopril.",
  direction: "higher",
  unit: "mg/dL",
  view: "/pods/p/trend?test=2160-0",
  test: { code: "2160-0", name: "Creatinine" },
  medication: { name: "lisinopril 10 MG Oral Tablet" },
  before: { count: 1, mean: 0.88, min: 0.88, max: 0.88 },
  after: { count: 1, mean: 1.02, min: 1.02, max: 1.02 },
  rows: [
    row("before", "0.88", "2026-01-02"),
    row("after", "1.02", "2026-03-02"),
  ],
};

/** The two results of one side being 0.88 and 1.02, as the issue's pair has them. */
const together: Found = {
  ...creatinine,
  key: "creatinine-both",
  before: { count: 2, mean: 0.95, min: 0.88, max: 1.02 },
  after: { count: 1, mean: 1.5, min: 1.5, max: 1.5 },
  rows: [
    row("before", "0.88", "2026-01-02"),
    row("before", "1.02", "2026-02-02"),
    row("after", "1.5", "2026-03-02"),
  ],
};

const thin = (test: string, code: string): Found => ({
  key: `thin-${code}`,
  direction: "not enough results",
  unit: "mg/dL",
  view: `/pods/p/trend?test=${code}`,
  test: { code, name: test },
  medication: { name: "ondansetron 4 MG Disintegrating Oral Tablet" },
  before: { count: 0, mean: 0, min: 0, max: 0 },
  after: { count: 1, mean: 4, min: 4, max: 4 },
  rows: [row("after", "4", "2026-03-02")],
});

const call = (
  name: string,
  input: object,
  output?: unknown,
  state = output === undefined ? "input-available" : "output-available",
) =>
  ({
    type: `tool-${name}`,
    toolCallId: `${name}-${JSON.stringify(input)}`,
    state,
    input,
    output,
  }) as unknown as UIMessage["parts"][number];

const turn = (...parts: UIMessage["parts"]): UIMessage => ({
  id: "m1",
  role: "assistant",
  parts,
});

const user: UIMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "Find anything interesting in this pod" }],
};

describe("what a turn says while the model works", () => {
  test("before any tool is called it says it is reading the question", () => {
    expect(workingSaid([user])).toBe("Reading the question");
    expect(workingSaid([user, turn()])).toBe("Reading the question");
  });

  test("a tool still running is named in the app's words, a medication by the name it was given", () => {
    expect(
      workingSaid([
        user,
        turn(call("timeline", { pod: "p" }, [{}]), call("ask", { question: "pod/My active medications" })),
      ]),
    ).toBe("Reading active medications");
    expect(
      workingSaid([user, turn(call("find_changes", { medication: "ondansetron" }))]),
    ).toBe("Looking at lab results after ondansetron");
  });

  test("a code says nothing read alone, so the step does not repeat it", () => {
    const [step] = stepsOf(turn(call("find_changes", { medication: "617310", test: "2160-0" })));
    expect(stepSaid(step!)).toBe("Looking at lab results after medications");
  });

  test("the reply tool is not a step: it never runs on the page, so it is not working and it is not listed", () => {
    const withReply = turn(call("reply", { items: [] }));
    expect(stepsOf(withReply)).toEqual([]);
    expect(workingSaid([user, withReply])).toBe("Reading the question");
    expect(
      workingSaid([user, turn(call("timeline", { pod: "p" }, []), call("reply", { items: [] }))]),
    ).toBe("Putting the answer together");
    expect(renderToStaticMarkup(<LookedAt message={withReply} open={() => {}} />)).toBe("");
  });

  test("once every tool has answered it says the answer is being put together", () => {
    expect(
      workingSaid([user, turn(call("timeline", { pod: "p" }, []))]),
    ).toBe("Putting the answer together");
  });
});

describe("what it looked at, folded after the answer", () => {
  const html = (...parts: UIMessage["parts"]) =>
    renderToStaticMarkup(<LookedAt message={turn(...parts)} open={() => {}} />);

  test("a turn with no tool call has no fold", () => {
    expect(html()).toBe("");
  });

  test("the fold counts the steps and names each in words, behind a closed details", () => {
    const drawn = html(
      call("timeline", { pod: "p" }, []),
      call("find_changes", { pod: "p" }, [creatinine]),
    );
    expect(drawn).toContain("<details");
    expect(drawn).not.toContain("open");
    expect(drawn).toContain("What it looked at (2 steps)");
    expect(drawn).toContain("Read the medications and the day each started");
    expect(drawn).toContain("Looked at lab results after lisinopril 10 MG Oral Tablet");
  });

  test("one step is said in the singular", () => {
    expect(html(call("list_pods", {}, { pods: [] }))).toContain("(1 step)");
  });

  test("a finding with a direction is one compact line: the app's sentence, its numbers and Open the trend, no card", () => {
    const drawn = html(call("find_changes", { pod: "p" }, [creatinine]));
    expect(drawn).toContain("Creatinine went up after lisinopril.");
    expect(drawn).toContain("Before: mean 0.88 mg/dL over 1 result (0.88 to 0.88)");
    expect(drawn).not.toContain("card");
    expect(drawn.match(/Open the trend/g)).toHaveLength(1);
    expect(drawn).not.toContain("<a ");
  });

  test("a change with not enough results has no trend to open", () => {
    expect(html(call("find_changes", { pod: "p" }, [thin("Sodium", "2951-2")]))).not.toContain(
      "Open the trend",
    );
  });

  test("a test with neither a name nor a notation is said as a test, never by its code", () => {
    const bare: Found = { ...thin("x", "2345-7"), test: { code: "2345-7" } };
    const drawn = html(call("find_changes", { pod: "p" }, [bare]));
    expect(drawn).toContain("Not enough results to compare: a test around");
    expect(drawn).not.toContain("2345-7");
  });

  test("a change with not enough results is one quiet line listing the tests, never a card each", () => {
    const drawn = html(
      call("find_changes", { pod: "p" }, [
        thin("Creatinine", "2160-0"),
        thin("Sodium", "2951-2"),
        thin("Potassium", "2823-3"),
      ]),
    );
    expect(drawn.match(/not enough results/gi)).toHaveLength(1);
    expect(drawn).toContain(
      "Not enough results to compare: Creatinine, Sodium, Potassium around ondansetron 4 MG Disintegrating Oral Tablet",
    );
    expect(drawn).not.toContain("mean");
  });

  test("a step that gave nothing is said so, and its findings are not read", () => {
    const [step] = stepsOf(turn(call("find_changes", { pod: "p" }, undefined, "output-error")));
    expect(stepSaid(step!)).toBe("Looked at lab results after medications, which gave nothing");
  });
});

describe("a side's numbers keep the results' precision", () => {
  test("results 0.88 and 1.02 show the mean 0.95 and the range 0.88 to 1.02", () => {
    expect(
      sideSaid("Before", together.before, "mg/dL", ["0.88", "1.02"]),
    ).toBe("Before: mean 0.95 mg/dL over 2 results (0.88 to 1.02)");
  });

  test("whole-number results keep the mean to one decimal and the extremes as they are", () => {
    expect(
      sideSaid("After", { count: 3, mean: 142.3333, min: 140, max: 145 }, "mmol/L", ["140", "142", "145"]),
    ).toBe("After: mean 142.3 mmol/L over 3 results (140 to 145)");
  });

  test("results 1.10 and 1.30 keep their written decimals: the mean 1.20 and the range 1.10 to 1.30", () => {
    expect(
      sideSaid("Before", { count: 2, mean: 1.2, min: 1.1, max: 1.3 }, "mg/dL", ["1.10", "1.30"]),
    ).toBe("Before: mean 1.20 mg/dL over 2 results (1.10 to 1.30)");
  });

  test("a side with no results says so", () => {
    expect(sideSaid("Before", thin("x", "1").before, "mg/dL", [])).toBe("Before: no results");
  });

  test("a compact finding draws both sides from its own rows", () => {
    const drawn = renderToStaticMarkup(
      <LookedAt message={turn(call("find_changes", { pod: "p" }, [together]))} open={() => {}} />,
    );
    expect(drawn).toContain("Before: mean 0.95 mg/dL over 2 results (0.88 to 1.02)");
    expect(drawn).toContain("After: mean 1.5 mg/dL over 1 result (1.5 to 1.5)");
  });
});
