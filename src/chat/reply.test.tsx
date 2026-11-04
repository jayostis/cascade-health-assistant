import type { CheckedReply } from "cascade-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import fixture from "./checked-reply.fixture.json" with { type: "json" };
import { ReplyCards } from "./reply.tsx";

/** Priya's pod, checked by the pinned runtime: three points, one of them with a fact that fails, one that names no record. */
const checked = fixture as unknown as CheckedReply;
const POD = "priya-natarajan-eval-case";
const TSH_ID = "0d8c933a39c754242aa4fb5a1032cfc8be460f67170efed924b99acf15b13f2e";
const DISCHARGE_ID =
  "b9044974ee05e2c329f1eb42605c9eb2ae5e3b697e16d05f04228d527a7274e1";

const draw = (reply: CheckedReply) =>
  renderToStaticMarkup(<ReplyCards checked={reply} pod={POD} />);

/** The markup of each point, in the order drawn. */
const points = (html: string) =>
  html.split(/(?=<article )/).filter((part) => part.startsWith("<article "));

/** The markup of the chip that names `text`: each fact is an item of the point's list of chips. */
const chipWith = (html: string, text: string) =>
  [...html.matchAll(/<li class="chip-item">(.*?)<\/li>/gs)]
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
      "The hospital stopped it",
    ])
      expect(html).not.toContain(says);
  });

  test("an absence names what was searched and whether the search is backed", () => {
    const [first] = points(html);
    expect(first).toContain("Searched: a TSH or free T4 after 6 Mar 2026");
    expect(first).toContain("all sources");
    expect(first).toContain("found nothing");
    expect(first).toContain(
      "Searched: a TSH after 6 Mar 2026, from a search that was never run",
    );
    expect(first).toContain("no such call");
  });

  test("the model's knowledge is labelled, with its source or the lack of one", () => {
    const [first, second, third] = points(html);
    expect(first).toContain("General information, not from your records");
    expect(first).toContain("standard thyroid testing practice");
    expect(second).not.toContain("General information");
    expect(third).toContain("CDC/ACIP");
    const bare = structuredClone(checked) as { reply: { items: { knowledge?: { guideline?: string } }[] } };
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
    return { ...base, reply: { ...base.reply, items: reply }, items } as unknown as CheckedReply;
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
});
