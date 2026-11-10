import type { CheckedReply } from "cascade-runtime";
import type { UIMessage } from "ai";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import fixture from "./checked-reply.fixture.json" with { type: "json" };
import { sideSaid, stepSaid, stepsOf, workingSaid, type Found } from "./steps.ts";
import { LookedAt, Supporting, Working } from "./turn.tsx";

/** Priya's pod's reply, checked: seven facts, five confirmed, and two searches, one of them not backed. */
const reply = fixture as unknown as CheckedReply;

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

/**
 * While the model works the chat shows one line naming its current step, written from the tool's name and input and never
 * from the model's words. A person sees what is being read without seeing a raw tool call.
 */
describe("Saying what a model is doing while it works · workingSaid(), stepSaid(), stepsOf(), Working", () => {
  describe("workingSaid(messages)", () => {
    it("returns `Reading the question` before any tool is called", () => {
      expect(workingSaid([user]), "no turn yet").toBe("Reading the question");
      expect(workingSaid([user, turn()]), "a turn with no tool call").toBe("Reading the question");
    });

    it("names the tool still running in the app's words: `Reading active medications` for `ask` of `pod/My active medications`", () => {
      expect(
        workingSaid([
          user,
          turn(call("timeline", { pod: "p" }, [{}]), call("ask", { question: "pod/My active medications" })),
        ]),
      ).toBe("Reading active medications");
    });

    it("names a medication by the name the tool was given", () => {
      expect(workingSaid([user, turn(call("find_changes", { medication: "ondansetron" }))])).toBe(
        "Looking at lab results after ondansetron",
      );
    });

    it("returns `Putting the answer together` once every tool has answered", () => {
      expect(workingSaid([user, turn(call("timeline", { pod: "p" }, []))])).toBe("Putting the answer together");
    });

    it("returns `Checking the answer against the records` when `checking` is set", () => {
      const done = [user, turn(call("timeline", { pod: "p" }, []))];
      expect(workingSaid(done, true)).toBe("Checking the answer against the records");
    });

    it("ignores a call to a tool named `reply`", () => {
      const withReply = turn(call("reply", { items: [] }));
      expect(workingSaid([user, withReply]), "only a reply call").toBe("Reading the question");
      expect(
        workingSaid([user, turn(call("timeline", { pod: "p" }, []), call("reply", { items: [] }))]),
        "a reply call after a tool that answered",
      ).toBe("Putting the answer together");
    });
  });

  describe("stepSaid(step)", () => {
    it("says `medications` in place of a medication's code, which says nothing read alone", () => {
      const [step] = stepsOf(turn(call("find_changes", { medication: "617310", test: "2160-0" })));
      expect(stepSaid(step!)).toBe("Looking at lab results after medications");
    });
  });

  describe("stepsOf(message)", () => {
    it("lists no step for a call to a tool named `reply`", () => {
      expect(stepsOf(turn(call("reply", { items: [] })))).toEqual([]);
    });
  });

  describe("`Working`", () => {
    it("draws the line with `…` after it", () => {
      const done = [user, turn(call("timeline", { pod: "p" }, []))];
      expect(renderToStaticMarkup(<Working messages={done} stoppable={false} checking />), "when checking").toContain(
        "Checking the answer against the records…",
      );
      expect(renderToStaticMarkup(<Working messages={done} stoppable={false} />), "when not").toContain(
        "Putting the answer together…",
      );
    });
  });
});

/**
 * Under an answer the chat draws one line saying what the check found, in the checker's counts and never the model's
 * words, folded over the cards and the steps. A person sees whether the answer was confirmed against their records
 * without looking inside the fold.
 */
describe("Summing up a reply's check in one line · Supporting", () => {
  const steps = [call("timeline", { pod: "p" }, []), call("find_changes", { pod: "p" }, [creatinine])];
  const draw = (checked: CheckedReply | undefined, parts: UIMessage["parts"] = steps) =>
    renderToStaticMarkup(<Supporting message={turn(...parts)} checked={checked} pod="p" open={() => {}} />);
  /** The line the person reads folded, without its markup. */
  const line = (html: string) => /<summary[^>]*>(.*?)<\/summary>/s.exec(html)![1].replace(/<[^>]*>/g, "");
  const passing = (): CheckedReply => {
    const clone = structuredClone(reply) as unknown as {
      items: {
        facts: { verdict: object }[];
        absences: { backing: object }[];
      }[];
    };
    for (const item of clone.items) {
      for (const fact of item.facts) fact.verdict = { ok: true };
      for (const absence of item.absences) absence.backing = { backed: true };
    }
    return clone as unknown as CheckedReply;
  };
  /** `passing()` cut to its third item, with one confirmed fact and no absence. */
  const single = () => {
    const one = passing() as unknown as {
      items: { facts: unknown[]; absences: unknown[] }[];
    };
    one.items = [{ ...one.items[2], absences: [] }];
    return one as unknown as CheckedReply;
  };

  describe("given a reply whose facts and absences were all confirmed", () => {
    it("draws one closed fold", () => {
      const drawn = draw(passing());
      expect(drawn).toContain("<details");
      expect(drawn).not.toContain('open=""');
    });

    it("says `Checked against your records · 9 confirmed · 2 general, not from your records · 2 steps`", () => {
      expect(line(draw(passing()))).toBe(
        "Checked against your records · 9 confirmed · 2 general, not from your records · 2 steps",
      );
    });

    it("draws the cards and then the steps inside the fold", () => {
      const drawn = draw(passing());
      const cards = drawn.indexOf('class="cards');
      expect(cards).toBeGreaterThan(drawn.indexOf("</summary>"));
      expect(drawn.indexOf("looked-at")).toBeGreaterThan(cards);
      expect(drawn).toContain("Looked at lab results after lisinopril");
    });

    it("says `1 confirmed` and `1 step` in the singular", () => {
      expect(line(draw(single(), [steps[0]!]))).toBe(
        "Checked against your records · 1 confirmed · 1 general, not from your records · 1 step",
      );
    });

    it("leaves the steps off the line for a turn with no tool call", () => {
      expect(line(draw(single(), []))).toBe("Checked against your records · 1 confirmed · 1 general, not from your records");
    });

    it("counts only an item that has both the model's words and the check", () => {
      const wordless = passing() as unknown as { reply: { items: { n: number }[] } };
      wordless.reply.items = wordless.reply.items.filter(({ n }) => n !== 2);
      const drawn = draw(wordless as unknown as CheckedReply, []);
      expect(line(drawn)).toBe("Checked against your records · 7 confirmed · 2 general, not from your records");
      expect(drawn.match(/class="point/g)).toHaveLength(2);
    });
  });

  describe("given a fact or an absence the check could not confirm", () => {
    it("leads the line with how many could not be confirmed", () => {
      expect(line(draw(reply)), "a fact and two absences").toBe(
        "3 of 9 could not be confirmed against your records · 6 confirmed · 2 general, not from your records · 2 steps",
      );
      const failing = passing() as unknown as { items: { facts: { verdict: object }[] }[] };
      failing.items[0]!.facts[0]!.verdict = { ok: false, reason: "no such record", missing: [] };
      expect(line(draw(failing as unknown as CheckedReply, [])), "one fact failed").toMatch(
        /^1 of 9 could not be confirmed against your records · 8 confirmed/,
      );
    });

    it("marks the line `unconfirmed`, never `not-checked`", () => {
      const drawn = draw(reply);
      expect(drawn).toMatch(/<summary[^>]*class="[^"]*unconfirmed/);
      expect(drawn).not.toMatch(/<summary[^>]*class="[^"]*not-checked/);
    });
  });

  describe("given a reply with nothing to check", () => {
    it("says `Nothing in this reply was checked against your records`", () => {
      const none = passing() as unknown as {
        items: unknown[];
        reply: { items: { knowledge?: unknown }[] };
      };
      none.items = [];
      none.reply.items = none.reply.items.map(({ knowledge: _, ...rest }) => rest);
      expect(line(draw(none as unknown as CheckedReply, [steps[0]!]))).toBe(
        "Nothing in this reply was checked against your records · 1 step",
      );
    });

    it("draws the line alone, with no fold, for a turn with no step either", () => {
      const drawn = draw({ ...reply, items: [] }, []);
      expect(drawn).not.toContain("<details");
      expect(drawn).toContain("Nothing in this reply was checked against your records");
    });
  });

  describe("given a reply that was not checked", () => {
    it("says `Not checked:` with the checker's first reason, then the steps", () => {
      expect(line(draw({ errors: ["items: at most 10"], items: [] }))).toBe("Not checked: items: at most 10 · 2 steps");
    });

    it("says `(and 2 more)` after the first of three reasons", () => {
      expect(line(draw({ errors: ["a", "b", "c"], items: [] }))).toBe("Not checked: a (and 2 more) · 2 steps");
    });

    it("marks the line `not-checked`, with no cards under it", () => {
      const drawn = draw({ errors: ["items: at most 10"], items: [] });
      expect(drawn).toMatch(/<summary[^>]*class="[^"]*not-checked/);
      expect(drawn).not.toContain('class="cards');
    });

    it("says `Not checked:` for a `data-reply` part that is no checked reply", () => {
      expect(line(draw({} as CheckedReply)), "an empty part").toMatch(/^Not checked: /);
      expect(line(draw({ errors: [], items: "none" } as unknown as CheckedReply)), "items that are no list").toMatch(
        /^Not checked: /,
      );
    });

    it("draws the line with no fold for a turn with no step", () => {
      const drawn = draw({ errors: ["the reply is not JSON"], items: [] }, []);
      expect(drawn).not.toContain("<details");
      expect(drawn).toContain("Not checked: the reply is not JSON");
      expect(drawn).toContain("not-checked");
    });
  });

  describe("given a turn with no reply", () => {
    it("folds the steps behind `What it looked at`, with their count, closed", () => {
      const drawn = draw(undefined);
      expect(drawn).toContain("<details");
      expect(drawn).not.toContain('open=""');
      expect(line(drawn), "two steps").toBe("What it looked at (2 steps)");
      expect(line(draw(undefined, [steps[0]!])), "one step").toBe("What it looked at (1 step)");
    });

    it("draws nothing for a turn with no step", () => {
      expect(draw(undefined, [])).toBe("");
    });
  });
});

/**
 * Under the cards the fold lists each step of the turn in the app's words, and each lab change `find_changes` found as one
 * line with its numbers. The numbers are written as the results were, so a mean never looks more or less exact than the
 * lab's own figures.
 */
describe("Listing what a model looked at · LookedAt, sideSaid()", () => {
  const html = (...parts: UIMessage["parts"]) => renderToStaticMarkup(<LookedAt message={turn(...parts)} open={() => {}} />);

  describe("`LookedAt`", () => {
    it("draws nothing for a turn with no tool call", () => {
      expect(html(), "no part at all").toBe("");
      expect(html(call("reply", { items: [] })), "only a call to `reply`").toBe("");
    });

    it("names each step in words, in the order made, with no fold of its own", () => {
      const drawn = html(call("timeline", { pod: "p" }, []), call("find_changes", { pod: "p" }, [creatinine]));
      expect(drawn).not.toContain("<details");
      const first = drawn.indexOf("Read the medications and the day each started");
      expect(first).toBeGreaterThanOrEqual(0);
      expect(drawn.indexOf("Looked at lab results after", first)).toBeGreaterThan(first);
    });

    it("names the medication that every lab change of a step is about", () => {
      // The input names no medication; the name is the one all the step's lab changes share.
      const drawn = html(call("find_changes", { pod: "p" }, [creatinine]));
      expect(drawn).toContain("Looked at lab results after lisinopril 10 MG Oral Tablet");
    });

    it("says a failed step `gave nothing`", () => {
      const drawn = html(call("find_changes", { pod: "p" }, undefined, "output-error"));
      expect(drawn).toContain("Looked at lab results after medications, which gave nothing");
    });
  });

  describe("given a lab change with a direction", () => {
    it("draws one line: the app's sentence and each side's numbers", () => {
      const drawn = html(call("find_changes", { pod: "p" }, [creatinine]));
      expect(drawn).toContain("Creatinine went up after lisinopril.");
      expect(drawn).toContain("Before: mean 0.88 mg/dL over 1 result (0.88 to 0.88)");
    });

    it("draws one `Open the trend` button, and no link or card", () => {
      const drawn = html(call("find_changes", { pod: "p" }, [creatinine]));
      expect(drawn.match(/Open the trend/g)).toHaveLength(1);
      expect(drawn).not.toContain("<a ");
      expect(drawn).not.toContain("card");
    });

    it("draws both sides from the lab change's own results", () => {
      const drawn = html(call("find_changes", { pod: "p" }, [together]));
      expect(drawn).toContain("Before: mean 0.95 mg/dL over 2 results (0.88 to 1.02)");
      expect(drawn).toContain("After: mean 1.5 mg/dL over 1 result (1.5 to 1.5)");
    });
  });

  describe("given lab changes with not enough results", () => {
    it("draws no `Open the trend`", () => {
      expect(html(call("find_changes", { pod: "p" }, [thin("Sodium", "2951-2")]))).not.toContain("Open the trend");
    });

    it("lists the tests in one line, with the medication they share", () => {
      const drawn = html(
        call("find_changes", { pod: "p" }, [thin("Creatinine", "2160-0"), thin("Sodium", "2951-2"), thin("Potassium", "2823-3")]),
      );
      expect(drawn.match(/not enough results/gi)).toHaveLength(1);
      expect(drawn).toContain(
        "Not enough results to compare: Creatinine, Sodium, Potassium around ondansetron 4 MG Disintegrating Oral Tablet",
      );
      expect(drawn).not.toContain("mean");
    });

    it("says `a test` for a test with no name, never its code", () => {
      const bare: Found = { ...thin("x", "2345-7"), test: { code: "2345-7" } };
      const drawn = html(call("find_changes", { pod: "p" }, [bare]));
      expect(drawn).toContain("Not enough results to compare: a test around");
      expect(drawn).not.toContain("2345-7");
    });
  });

  describe("sideSaid(name, side, unit, values)", () => {
    it("keeps the two decimals results are written with: mean 0.95, range 0.88 to 1.02", () => {
      expect(sideSaid("Before", together.before, "mg/dL", ["0.88", "1.02"])).toBe(
        "Before: mean 0.95 mg/dL over 2 results (0.88 to 1.02)",
      );
    });

    it("keeps one decimal in the mean of whole-number results, and the extremes as written", () => {
      expect(
        sideSaid("After", { count: 3, mean: 142.3333, min: 140, max: 145 }, "mmol/L", ["140", "142", "145"]),
      ).toBe("After: mean 142.3 mmol/L over 3 results (140 to 145)");
    });

    it("keeps a written trailing zero: 1.10 and 1.30 give the mean 1.20", () => {
      expect(sideSaid("Before", { count: 2, mean: 1.2, min: 1.1, max: 1.3 }, "mg/dL", ["1.10", "1.30"])).toBe(
        "Before: mean 1.20 mg/dL over 2 results (1.10 to 1.30)",
      );
    });

    it("returns `Before: no results` for a side with none", () => {
      expect(sideSaid("Before", thin("x", "1").before, "mg/dL", [])).toBe("Before: no results");
    });
  });
});
