import type { CheckedReply } from "cascade-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import fixture from "./checked-reply.fixture.json" with { type: "json" };
import { ReplyCards } from "./reply.tsx";

/** Priya's pod, checked by the pinned runtime: three points, one of them with a fact that fails, one that names no record. */
const checked = fixture as unknown as CheckedReply;
const POD = "priya-natarajan-eval-case";
const TSH_ID = "0d8c933a39c754242aa4fb5a1032cfc8be460f67170efed924b99acf15b13f2e";
const DISCHARGE_ID = "b9044974ee05e2c329f1eb42605c9eb2ae5e3b697e16d05f04228d527a7274e1";

const draw = (reply: CheckedReply) => renderToStaticMarkup(<ReplyCards checked={reply} pod={POD} />);

/** The markup of each point, in the order drawn. */
const points = (html: string) => html.split(/(?=<article )/).filter((part) => part.startsWith("<article "));

/** The markup of the chip that names `text`: each fact is an item of the point's list of chips. */
const chipWith = (html: string, text: string) =>
  [...html.matchAll(/<li class="chip-item[^"]*">(.*?)<\/li>/gs)].map((each) => each[1]).find((chip) => chip.includes(text));

/**
 * Inside the fold each item of a checked reply is a card and each fact a chip that shows what the pod holds of the record,
 * never the model's words for it. A person can tell at a glance which statements their records confirm, and open the
 * record behind each.
 */
describe("Drawing a checked reply as cards · ReplyCards", () => {
  describe("given a checked reply of three items", () => {
    const html = draw(checked);

    it("draws a card for each item, in the reply's order, headed by the item's own sentence", () => {
      const drawn = points(html);
      expect(drawn).toHaveLength(3);
      expect(drawn[0]).toContain("TSH was high in March 2026");
      expect(drawn[1]).toContain("Hydrochlorothiazide was stopped");
      expect(drawn[2]).toContain("Shingrix dose 1");
    });

    it("draws a fact that passed as a chip with a check mark and what the pod holds: its label, value, date and source", () => {
      const chip = chipWith(html, "Thyrotropin")!;
      expect(chip).toContain("confirmed");
      expect(chip).toContain("✓");
      expect(chip).toContain("7.9 m[IU]/L");
      expect(chip).toContain("Mar 3, 2026");
      expect(chip).toContain("Kestrel Harbor Hospital");
    });

    it("links a chip to the view entry's page by the last part of its IRI, never by its handle", () => {
      expect(chipWith(html, "Thyrotropin")).toContain(`href="/pods/${POD}/entries/${TSH_ID}"`);
      expect(html).not.toContain("L0d8c933a");
    });

    it("draws a fact that failed as `couldn't confirm`, with the checker's reason and no check mark", () => {
      const chip = chipWith(html, "Plan of Treatment")!;
      expect(chip).toContain("unconfirmed");
      expect(chip).toContain("couldn&#x27;t confirm");
      expect(chip).toContain("no such field");
      expect(chip).not.toContain("✓");
    });

    it("links a failed fact's chip to its view entry all the same", () => {
      expect(chipWith(html, "Plan of Treatment")).toContain(`href="/pods/${POD}/entries/${DISCHARGE_ID}"`);
    });

    it("draws a fact that names no record as a chip that links nowhere", () => {
      const chip = chipWith(html, "no such record")!;
      expect(chip).toContain("couldn&#x27;t confirm");
      expect(chip).not.toContain("href=");
    });

    it("never draws a fact's `says`, the model's own words for a record", () => {
      for (const says of ["TSH 7.9, high, on 3 Mar 2026", "The lab report for the repeat", "Sodium was low in June"])
        expect(html, says).not.toContain(says);
    });

    it("draws an absence as what was searched: its codes, the day it looked after and the tool call", () => {
      const [first] = points(html);
      expect(first).toContain("Searched: codes 3016-3, 3024-7 · after Mar 6, 2026 · ask call 1");
      expect(first).toContain("Searched: code 3016-3 · after Mar 6, 2026 · ask call 9");
    });

    it("says `nothing found` for a backed absence, and the reason for one that is not", () => {
      const [first] = points(html);
      expect(first).toContain("nothing found");
      expect(first).toContain("no such call");
    });

    it("never draws the model's words for what it searched", () => {
      for (const said of [
        "a TSH or free T4 after 6 Mar 2026",
        "a TSH after 6 Mar 2026, from a search that was never run",
        "all sources",
      ])
        expect(html, said).not.toContain(said);
    });

    it("marks an item's `knowledge` as general information, with the source it names", () => {
      const [first, second, third] = points(html);
      expect(first).toContain("General information, not from your records");
      expect(first).toContain("standard thyroid testing practice");
      expect(second).not.toContain("General information");
      expect(third).toContain("CDC/ACIP");
    });

    it("says `No source named` for knowledge with no `guideline`", () => {
      const bare = structuredClone(checked) as unknown as {
        reply: { items: { knowledge?: { guideline?: string } }[] };
      };
      delete bare.reply.items[0]!.knowledge!.guideline;
      expect(draw(bare as unknown as CheckedReply)).toContain("No source named");
    });
  });

  /** `count` items, the fixture's three over again, each headed `Point <n>`. */
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

  describe("with six items", () => {
    it("draws the first four and a button `Show items 5 to 6`", () => {
      const html = draw(many(6));
      expect(points(html)).toHaveLength(4);
      expect(html).toContain("Point 4");
      expect(html).not.toContain("Point 5");
      expect(html).toContain("Show items 5 to 6");
    });
  });

  describe("with four items", () => {
    it("draws all four and no button", () => {
      const html = draw(many(4));
      expect(points(html)).toHaveLength(4);
      expect(html).not.toContain("Show items");
    });
  });

  describe("given a fact with a quote", () => {
    /** The fixture with its first item's first fact quoting a discharge note, which the check found when `ok`. */
    const quoting = (ok: boolean) => {
      const clone = structuredClone(checked) as unknown as {
        items: { facts: { fact: object; verdict: object }[] }[];
      };
      const [fact] = clone.items[0]!.facts;
      fact!.fact = {
        says: "The discharge says to stop it",
        cite: { entry: "Nb9044974" },
        field: "text",
        quote: "STOP taking hydrochlorothiazide",
      };
      fact!.verdict = ok
        ? { ok: true }
        : { ok: false, reason: "says otherwise", missing: ["quote STOP taking hydrochlorothiazide"] };
      return draw(clone as unknown as CheckedReply);
    };

    it("draws the quote as the source's words once the check found it", () => {
      expect(chipWith(quoting(true), "Thyrotropin")).toContain('<q class="quote">STOP taking hydrochlorothiazide</q>');
    });

    it("draws no quotation for a quote the check did not find", () => {
      expect(quoting(false)).not.toContain("<q");
    });

    it("leaves the quote out of the reason the chip gives", () => {
      const chip = chipWith(quoting(false), "Thyrotropin")!;
      expect(chip).toContain("says otherwise");
      expect(chip).not.toContain("STOP taking");
    });
  });

  describe("given a view entry whose IRI needs encoding", () => {
    it("encodes the last part of the IRI in the link", () => {
      const clone = structuredClone(checked) as unknown as {
        items: { facts: { filled?: { entry: string } }[] }[];
      };
      clone.items[0]!.facts[0]!.filled!.entry = "urn:cascade:a/b?c d#e/f?g h&i";
      expect(draw(clone as unknown as CheckedReply)).toContain(`href="/pods/${POD}/entries/e%2Ff%3Fg%20h%26i"`);
    });
  });

  describe("with nothing to draw", () => {
    it("draws nothing for a reply that broke the contract", () => {
      // That it was not checked is the folded line's to say (`Supporting`).
      expect(draw({ errors: ["items: at most 10"], items: [] })).toBe("");
    });

    it("draws nothing for a `data-reply` part that is no checked reply", () => {
      expect(draw({} as CheckedReply), "an empty part").toBe("");
      expect(draw({ errors: [], items: "none" } as unknown as CheckedReply), "items that are no list").toBe("");
    });

    it("draws nothing for a checked reply with no items", () => {
      expect(draw({ ...checked, items: [] })).toBe("");
    });
  });
});
