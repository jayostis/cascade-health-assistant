import type { CheckedReply } from "cascade-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import fixture from "./checked-reply.fixture.json" with { type: "json" };
import { ReplyCards } from "./reply.tsx";

/** Priya's pod, checked by the pinned runtime: three points, one of them with a fact that fails, one that names no record. */
const checked = fixture as unknown as CheckedReply;
const POD = "priya-natarajan-eval-case";
const TSH_ID =
  "0d8c933a39c754242aa4fb5a1032cfc8be460f67170efed924b99acf15b13f2e";
const DISCHARGE_ID =
  "b9044974ee05e2c329f1eb42605c9eb2ae5e3b697e16d05f04228d527a7274e1";

const draw = (reply: CheckedReply) =>
  renderToStaticMarkup(<ReplyCards checked={reply} pod={POD} />);

/** The markup of each point, in the order drawn. */
const points = (html: string) =>
  html.split(/(?=<article )/).filter((part) => part.startsWith("<article "));

/** The markup of the chip that names `text`: each fact is an item of the point's list of chips. */
const chipWith = (html: string, text: string) =>
  [...html.matchAll(/<li class="chip-item[^"]*">(.*?)<\/li>/gs)]
    .map((each) => each[1])
    .find((chip) => chip.includes(text));

describe("a checked reply drawn as cards", () => {
  const html = draw(checked);

  test("each point is a card, in the model's order, with its own words as the heading", () => {
    const drawn = points(html);
    expect(drawn).toHaveLength(3);
    expect(drawn[0]).toContain("TSH was high in March 2026");
    expect(drawn[1]).toContain("Hydrochlorothiazide was stopped");
    expect(drawn[2]).toContain("Shingrix dose 1");
  });

  test("a fact that passed is a chip with a check mark, shown with what the pod holds, and opens the entry by its IRI", () => {
    const chip = chipWith(html, "Thyrotropin")!;
    expect(chip).toContain("confirmed");
    expect(chip).toContain("✓");
    expect(chip).toContain("7.9 m[IU]/L");
    expect(chip).toContain("Mar 3, 2026");
    expect(chip).toContain("Kestrel Harbor Hospital");
    expect(chip).toContain(`href="/pods/${POD}/entries/${TSH_ID}"`);
    expect(html).not.toContain("L0d8c933a");
  });

  test("a fact the checker could not confirm says so, with why, and still opens the entry", () => {
    const chip = chipWith(html, "Plan of Treatment")!;
    expect(chip).toContain("unconfirmed");
    expect(chip).toContain("couldn&#x27;t confirm");
    expect(chip).toContain("no such field");
    expect(chip).not.toContain("✓");
    expect(chip).toContain(`href="/pods/${POD}/entries/${DISCHARGE_ID}"`);
  });

  test("a fact that names no record is a chip that opens nothing", () => {
    const chip = chipWith(html, "no such record")!;
    expect(chip).toContain("couldn&#x27;t confirm");
    expect(chip).not.toContain("href=");
  });

  test("the model's own words for a fact are never drawn as the record", () => {
    for (const says of [
      "TSH 7.9, high, on 3 Mar 2026",
      "The lab report for the repeat",
      "Sodium was low in June",
    ])
      expect(html).not.toContain(says);
  });

  test("an absence names what was searched and whether the search is backed", () => {
    const [first] = points(html);
    expect(first).toContain(
      "Searched: codes 3016-3, 3024-7 · after Mar 6, 2026 · ask call 1",
    );
    expect(first).toContain("nothing found");
    expect(first).toContain(
      "Searched: code 3016-3 · after Mar 6, 2026 · ask call 9",
    );
    expect(first).toContain("no such call");
  });

  test("the line of what was searched is drawn from what the program re-ran, never the model's words for it", () => {
    for (const said of [
      "a TSH or free T4 after 6 Mar 2026",
      "a TSH after 6 Mar 2026, from a search that was never run",
      "all sources",
    ])
      expect(html).not.toContain(said);
  });

  test("the model's knowledge is labelled, with its source or the lack of one", () => {
    const [first, second, third] = points(html);
    expect(first).toContain("General information, not from your records");
    expect(first).toContain("standard thyroid testing practice");
    expect(second).not.toContain("General information");
    expect(third).toContain("CDC/ACIP");
    const bare = structuredClone(checked) as unknown as {
      reply: { items: { knowledge?: { guideline?: string } }[] };
    };
    delete bare.reply.items[0].knowledge!.guideline;
    expect(draw(bare as unknown as CheckedReply)).toContain("No source named");
  });
});

describe("how many points show", () => {
  const many = (count: number): CheckedReply => {
    const base = structuredClone(checked) as unknown as {
      reply: { items: { n: number; says: string }[] };
      items: { n: number }[];
    };
    const reply = Array.from({ length: count }, (_, at) => ({
      ...base.reply.items[at % 3],
      n: at + 1,
      says: `Point ${at + 1}`,
    }));
    const items = Array.from({ length: count }, (_, at) => ({
      ...base.items[at % 3],
      n: at + 1,
    }));
    return {
      ...base,
      reply: { ...base.reply, items: reply },
      items,
    } as unknown as CheckedReply;
  };

  test("four show, and a button offers the rest", () => {
    const html = draw(many(6));
    expect(points(html)).toHaveLength(4);
    expect(html).toContain("Point 4");
    expect(html).not.toContain("Point 5");
    expect(html).toContain("Show items 5 to 6");
  });

  test("four points or fewer show with no button", () => {
    const html = draw(many(4));
    expect(points(html)).toHaveLength(4);
    expect(html).not.toContain("Show items");
  });
});

describe("a quote", () => {
  const quoting = (ok: boolean) => {
    const clone = structuredClone(checked) as unknown as {
      items: { facts: { fact: object; verdict: object }[] }[];
    };
    const [fact] = clone.items[0].facts;
    fact.fact = {
      says: "The discharge says to stop it",
      cite: { entry: "Nb9044974" },
      field: "text",
      quote: "STOP taking hydrochlorothiazide",
    };
    fact.verdict = ok
      ? { ok: true }
      : {
          ok: false,
          reason: "says otherwise",
          missing: ["quote STOP taking hydrochlorothiazide"],
        };
    return draw(clone as unknown as CheckedReply);
  };

  test("is shown, in the source's words, once the check found it whole in the entry", () => {
    expect(chipWith(quoting(true), "Thyrotropin")).toContain(
      '<q class="quote">STOP taking hydrochlorothiazide</q>',
    );
  });

  test("is not set as the source's words when the check did not find it", () => {
    expect(quoting(false)).not.toContain("<q");
  });

  test("is never drawn inside the reason a chip could not confirm", () => {
    const chip = chipWith(quoting(false), "Thyrotropin")!;
    expect(chip).toContain("says otherwise");
    expect(chip).not.toContain("STOP taking");
  });
});

describe("an entry whose IRI has odd characters", () => {
  test("opens at an address with the part encoded", () => {
    const clone = structuredClone(checked) as unknown as {
      items: { facts: { filled?: { entry: string } }[] }[];
    };
    clone.items[0].facts[0].filled!.entry = "urn:cascade:a/b?c d#e/f?g h&i";
    expect(draw(clone as unknown as CheckedReply)).toContain(
      `href="/pods/${POD}/entries/e%2Ff%3Fg%20h%26i"`,
    );
  });
});

describe("a reply that did not fit the contract", () => {
  const broken: CheckedReply = {
    errors: ["items: at most 10"],
    items: [],
  };

  test("is not drawn as cards, and says it was not checked", () => {
    const html = draw(broken);
    expect(points(html)).toHaveLength(0);
    expect(html).toContain("Not checked");
  });

  test("nor is a part that is not a checked reply at all, which draws no error of its own", () => {
    expect(draw({} as CheckedReply)).toContain("Not checked");
    expect(
      draw({ errors: [], items: "none" } as unknown as CheckedReply),
    ).toContain("Not checked");
  });

  test("a checked reply with no points draws nothing", () => {
    expect(draw({ ...checked, items: [] })).toBe("");
  });
});
