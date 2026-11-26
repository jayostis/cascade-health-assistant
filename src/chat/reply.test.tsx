import type { CheckedReply, HeldItem } from "cascade-runtime";
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

    it("marks an item's `knowledge` as general information, with the guideline it names",() => {
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

    it("draws the quote as the record's words once the check found it", () => {
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

  describe("given a fact that names the field it rests on", () => {
    const FERNHILL = "S3 Fernhill Family Clinic";
    const NORTH = "S12 North Clinic";
    // the records of the runtime's own test pod: S3 states two of them, S12 one
    const RECORD_3 = "urn:uuid:2a2516eb-46b0-8352-9042-93639f23ae9c";
    const RECORD_12 = "urn:uuid:ca582a17-052b-890b-a5ad-0f2567e25670";
    const RECORD_3_ELSEWHERE = "urn:uuid:80afad1b-91cb-8766-b527-1beabf2a4158";

    /** A dosage part as `checkReply` returns it for `property: structuredDosage`: its fields, and its dose beneath it. */
    const dosage = (
      sources: string[],
      records: string[],
      dose: { written: string; comparator?: string },
    ): HeldItem => ({
      sources,
      records,
      part: "structuredDosage 1",
      fields: [
        { name: "dosageRepeatFrequency", value: "3" },
        { name: "dosageRepeatPeriod", value: "1" },
        { name: "dosageRepeatPeriodUnit", value: "d" },
        { name: "dosageRouteCode", value: "http://snomed.info/id/26643006", label: "Oral route" },
      ],
      parts: [
        {
          part: "structuredDosage 1/dosageDoseQuantity",
          fields: [
            { name: "decimalValue", value: dose.written },
            ...(dose.comparator === undefined ? [] : [{ name: "quantityComparator", value: dose.comparator }]),
            { name: "unitText", value: "tablet" },
            { name: "writtenValue", value: dose.written },
          ],
        },
      ],
    });

    /** The fixture's first fact, now a drug that rests on `property` and holds `held`, from `sources`. */
    const resting = (property: string, held: HeldItem[], sources: string[]) => {
      const clone = structuredClone(checked) as unknown as {
        items: { facts: { fact: { property?: string }; filled: Record<string, unknown> }[] }[];
      };
      const [fact] = clone.items[0]!.facts;
      fact!.fact.property = property;
      Object.assign(fact!.filled, { label: "lisinopril 10 MG Oral Tablet", held, sources });
      delete fact!.filled.value;
      delete fact!.filled.date;
      return chipWith(draw(clone as unknown as CheckedReply), "lisinopril")!;
    };

    /** What a person must never read: the pod's own names, a source's short name, a record's address. */
    const rawWords = ["structuredDosage", "writtenValue", "dosageRepeat", "urn:", "S3", "S12"];

    it("draws one source's dosage as a line of words with the place it is from", () => {
      const chip = resting("structuredDosage", [dosage(["S3"], [RECORD_3], { written: "2" })], [FERNHILL]);
      expect(chip).toContain("Dosage: 2 tablet · 3 per 1 day · Oral route (snomed:26643006) · from Fernhill Family Clinic");
      for (const raw of rawWords) expect(chip, raw).not.toContain(raw);
    });

    it("draws each source's dosage in a block of its own, led by its place, when two sources disagree", () => {
      const chip = resting(
        "dosageDoseQuantity",
        [dosage(["S3"], [RECORD_3], { written: "2" }), dosage(["S12"], [RECORD_12], { written: "1" })],
        [FERNHILL, NORTH],
      );
      expect(chip).toMatch(/Fernhill Family Clinic[^]*Dosage: 2 tablet[^]*North Clinic[^]*Dosage: 1 tablet/);
      expect(chip.match(/class="held /g)).toHaveLength(2);
      for (const raw of rawWords) expect(chip, raw).not.toContain(raw);
    });

    it("tells two records of one source apart: a block each, both led by the place alone, no number", () => {
      const chip = resting(
        "structuredDosage",
        [
          dosage(["S3"], [RECORD_3], { written: "2" }),
          dosage(["S3"], [RECORD_3_ELSEWHERE], { written: "1", comparator: "<=" }),
        ],
        [FERNHILL],
      );
      expect(chip).toMatch(/Fernhill Family Clinic<\/span>[^]*Dosage: 2 tablet[^]*Fernhill Family Clinic<\/span>[^]*Dosage: at most 1 tablet/);
      expect(chip.match(/class="held /g)).toHaveLength(2);
      expect(chip).not.toMatch(/record \d/);
      for (const raw of rawWords) expect(chip, raw).not.toContain(raw);
    });

    // The runtime's own items for "keeps two records of one source apart" (test/held.test.ts at the pinned build), from
    // the vocabulary's fixture `a-medicine-with-two-dosages-shows-each-dose-on-its-own-dosage`: one record holds two
    // dosages, another record of the same source holds a third.
    const ROUTE = { name: "dosageRouteCode", value: "http://snomed.info/id/26643006" };
    const EVERY_DAY = [
      { name: "dosageRepeatPeriod", value: "1" },
      { name: "dosageRepeatPeriodUnit", value: "d" },
    ];
    const A_10: HeldItem = {
      sources: ["S3"],
      records: [RECORD_3],
      part: "structuredDosage 1",
      fields: [
        { name: "dosageRepeatFrequency", value: "1" },
        ...EVERY_DAY,
        ROUTE,
        { name: "dosageRouteCodeInOtherSystem", value: "C38288" },
      ],
      parts: [
        {
          part: "structuredDosage 1/dosageDoseQuantity",
          fields: [
            { name: "decimalValue", value: "10" },
            { name: "ucumUnit", value: "mg" },
            { name: "unitText", value: "milligram" },
            { name: "writtenValue", value: "10.0" },
          ],
        },
      ],
    };
    const A_2: HeldItem = {
      sources: ["S3"],
      records: [RECORD_3],
      part: "structuredDosage 2",
      fields: [
        { name: "dosageBoundsPeriodEnd", value: "2026-03-01T10:00:00Z" },
        { name: "dosageBoundsPeriodStart", value: "2026-02-01" },
        { name: "dosageRepeatFrequency", value: "2" },
        ...EVERY_DAY,
      ],
      parts: [
        {
          part: "structuredDosage 2/paddedDateTime dosageBoundsPeriodEnd",
          fields: [{ name: "timeAsWritten", value: "2026-03-01T10:00Z" }],
        },
      ],
    };
    const B_AT_MOST_2: HeldItem = {
      sources: ["S3"],
      records: [RECORD_3_ELSEWHERE],
      part: "structuredDosage 1",
      fields: [{ name: "dosageRepeatFrequency", value: "1" }, ...EVERY_DAY, ROUTE],
      parts: [
        {
          part: "structuredDosage 1/dosageDoseQuantity",
          fields: [
            { name: "decimalValue", value: "2" },
            { name: "quantityComparator", value: "<=" },
            { name: "unitText", value: "tablet" },
            { name: "writtenValue", value: "2" },
          ],
        },
      ],
    };

    it("draws the two dosages of one record as two lines of one block, in the runtime's order, and the other record's as a second", () => {
      const chip = resting("structuredDosage", [A_10, A_2, B_AT_MOST_2], [FERNHILL]);
      const [first, second, ...rest] = chip.split(/(?=<span class="held )/).slice(1);
      expect(rest).toHaveLength(0);
      expect(first!.match(/Dosage: /g)).toHaveLength(2);
      expect(first).toMatch(
        /Dosage: 10\.0 milligram · 1 per 1 day · route snomed:26643006[^]*Dosage: 2 per 1 day · from 2026-02-01 · until 2026-03-01T10:00Z/,
      );
      expect(first).not.toContain("at most");
      expect(second).toContain("Dosage: at most 2 tablet · 1 per 1 day · route snomed:26643006");
      expect(second!.match(/Dosage: /g)).toHaveLength(1);
      expect(chip.match(/Fernhill Family Clinic<\/span>/g)).toHaveLength(2);
    });

    it("draws a source with no place name as `Somewhere unnamed`, never its short name", () => {
      const chip = resting("dosageDoseQuantity", [dosage(["S3"], [RECORD_3], { written: "2" })], ["S3"]);
      expect(chip).toContain("Dosage: 2 tablet · 3 per 1 day · Oral route (snomed:26643006) · from Somewhere unnamed");
      for (const raw of rawWords) expect(chip, raw).not.toContain(raw);
      const two = resting(
        "dosageDoseQuantity",
        [dosage(["S3"], [RECORD_3], { written: "2" }), dosage(["S12"], [RECORD_12], { written: "1" })],
        ["S3", NORTH],
      );
      expect(two).toMatch(/Somewhere unnamed<\/span>[^]*Dosage: 2 tablet[^]*North Clinic<\/span>[^]*Dosage: 1 tablet/);
      for (const raw of rawWords) expect(two, raw).not.toContain(raw);
    });

    it("draws a comparator in front of its number: `at most 2 tablet`", () => {
      const chip = resting("dosageDoseQuantity", [dosage(["S12"], [RECORD_12], { written: "2", comparator: "<=" })], [NORTH]);
      expect(chip).toContain("Dosage: at most 2 tablet · 3 per 1 day");
      expect(chip).not.toContain("&lt;=");
    });

    it("draws the whole dosage for a fact that names only its route, never the route alone", () => {
      const chip = resting("dosageRouteCode", [dosage(["S3"], [RECORD_3], { written: "2" })], [FERNHILL]);
      expect(chip).toContain("Dosage: 2 tablet · 3 per 1 day · Oral route");
      expect(chip).not.toContain("dosage route code");
    });

    it("draws two sources that hold exactly the same as one line naming both places", () => {
      const chip = resting(
        "dosageDoseQuantity",
        [dosage(["S3", "S12"], [RECORD_3, RECORD_12], { written: "1" })],
        [FERNHILL, NORTH],
      );
      expect(chip.match(/Dosage: 1 tablet/g)).toHaveLength(1);
      expect(chip).toContain("from Fernhill Family Clinic, North Clinic");
    });

    it("draws a field of the entry as its name in words and its value, from the places that state it", () => {
      const chip = resting(
        "dosageInstructionText",
        [{ sources: ["S3"], records: [RECORD_3], fields: [{ name: "dosageInstructionText", value: "1 tablet by mouth every morning" }] }],
        [FERNHILL, NORTH],
      );
      expect(chip).toContain("Dosage instruction text: 1 tablet by mouth every morning · from Fernhill Family Clinic");
      expect(chip).not.toContain("North Clinic");
    });

    it("draws a value of the entry as a whole from every place the fact is from", () => {
      const chip = resting(
        "medicationRequestIntent",
        [{ sources: [], records: [], fields: [{ name: "medicationRequestIntent", value: "order" }] }],
        [FERNHILL, NORTH],
      );
      expect(chip).toContain("Medication request intent: order · from Fernhill Family Clinic, North Clinic");
    });

    it("draws two values of the entry as a whole that differ as two blocks, never one under every place", () => {
      const chip = resting(
        "medicationRequestIntent",
        [
          { sources: [], records: [], fields: [{ name: "medicationRequestIntent", value: "order" }] },
          { sources: [], records: [], fields: [{ name: "medicationRequestIntent", value: "plan" }] },
        ],
        [FERNHILL, NORTH],
      );
      expect(chip.match(/class="held /g)).toHaveLength(2);
      const [order, plan] = chip.split(/(?=<span class="held )/).slice(1);
      expect(order).toContain("Medication request intent: order");
      expect(order).not.toContain("intent: plan");
      expect(plan).toContain("Medication request intent: plan");
      expect(plan).not.toContain("intent: order");
    });

    it("draws nothing of `held` for a fact that names no field, which the label, value, date and place already say", () => {
      const chip = chipWith(draw(checked), "Thyrotropin")!;
      expect(chip.match(/7\.9/g)).toHaveLength(1);
      expect(chip).toContain("from Kestrel Harbor Hospital");
      expect(chip).not.toContain('class="held');
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
