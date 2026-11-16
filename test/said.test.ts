import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  codesOf,
  dayOrAsWritten,
  keptTitle,
  personName,
  reviewSaid,
  rowSaid,
  stepWhenSaid,
  typedName,
  utcInstant,
} from "../said.ts";

const item = { name: "Latex", one: "allergy" };

/**
 * What a What needs review query binds to `?needs`: each plain value, and one example of each value built by CONCAT.
 * An example is made of the CONCAT's own pieces, a quoted piece as written, an `IF` as its last quoted piece, a
 * `SUBSTR` as a date and any other as the number 3, so a change to a piece of the query changes the example.
 */
function needsIn(text: string) {
  const literals: string[] = [];
  const concatenated: string[] = [];
  for (const bound of text.matchAll(/BIND\s*\(((?:(?!BIND)[\s\S])*?)\s+AS\s+\?needs\)/g)) {
    const expression = bound[1]!;
    const built = /^\s*CONCAT\s*\(([\s\S]*)\)\s*$/.exec(expression);
    if (built !== null) concatenated.push(example(built[1]!));
    else literals.push(...[...expression.matchAll(/"([^"]*)"/g)].map((quoted) => quoted[1]!));
  }
  for (const pair of text.matchAll(/\(cascade:\w+\s+"([^"]+)"\)/g)) literals.push(pair[1]!);
  return { literals, concatenated };
}

/** One value of a CONCAT, from its arguments `"words ", STR(?n), IF(?n = 1, " one", " ones")`. */
function example(args: string): string {
  const pieces: string[] = [];
  let depth = 0;
  let start = 0;
  let quoted = false;
  for (let at = 0; at <= args.length; at++) {
    const char = args[at];
    if (char === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (char === "(") depth++;
    else if (char === ")") depth--;
    else if ((char === "," && depth === 0) || char === undefined) {
      pieces.push(args.slice(start, at).trim());
      start = at + 1;
    }
  }
  return pieces
    .map((piece) =>
      piece.startsWith('"')
        ? piece.slice(1, -1)
        : piece.startsWith("IF")
          ? [...piece.matchAll(/"([^"]*)"/g)].at(-1)![1]!
          : piece.startsWith("SUBSTR")
            ? "2024-05-01"
            : "3",
    )
    .join("");
}

/**
 * What the three What needs review questions of the vocabulary the installed runtime carries bind to `?needs`;
 * `change` edits each query's text first.
 */
function reviewNeeds(change: (text: string) => string = (text) => text) {
  const components = join(
    dirname(createRequire(import.meta.url).resolve("cascade-runtime/package.json")),
    "components",
    "cascade-vocabulary",
  );
  const version = readdirSync(components, { withFileTypes: true }).find((entry) => entry.isDirectory())!.name;
  const all = { literals: [] as string[], concatenated: [] as string[] };
  for (const kind of ["entry", "judgment", "record"]) {
    const found = needsIn(
      change(readFileSync(join(components, version, "queries", "questions", kind, "What needs review.rq"), "utf8")),
    );
    all.literals.push(...found.literals);
    all.concatenated.push(...found.concatenated);
  }
  return all;
}

/**
 * The app says what the pod holds in sentences a person reads: why an entry needs review, the day a version arrived, a
 * date inside a sentence in words, a count of submitters in words. A table row or a label keeps its short form.
 */
describe("Saying review reasons, dates and counts in words · reviewSaid(), stepWhenSaid(), dayOrAsWritten()", () => {
  describe("reviewSaid(row, item)", () => {
    it("says a sentence, not `name: needs.`, for every value the vocabulary's three What needs review questions bind", () => {
      const { literals, concatenated } = reviewNeeds();
      expect(literals.length, `read ${literals.length} values`).toBeGreaterThanOrEqual(14);
      for (const value of literals) {
        const sentence = reviewSaid({ needs: value }, item);
        expect(sentence, value).not.toBe(`Latex: ${value}.`);
        expect(sentence, `${value}: ${sentence}`).toContain("Latex");
      }
      expect(concatenated.length, concatenated.join(" | ")).toBe(2);
    });

    it("says a sentence for each value the vocabulary builds by CONCAT, built from the query's own pieces", () => {
      for (const value of reviewNeeds().concatenated)
        expect(reviewSaid({ needs: value }, item), value).not.toBe(`Latex: ${value}.`);
    });

    it("says the day of a value built by CONCAT in words", () => {
      expect(reviewSaid({ needs: "this source reports 3 records at states older than it reported on 2024-05-01" }, item)).toBe(
        "The source reports Latex and 2 more at states older than it reported on 1 May 2024.",
      );
    });

    it("keeps `name: needs.` for a value built by CONCAT once the query changes a tail of it", () => {
      const { concatenated } = reviewNeeds((text) => text.replace('" behind"', '" late"'));
      expect(
        concatenated.some((value) => reviewSaid({ needs: value }, item) === `Latex: ${value}.`),
        concatenated.join(" | "),
      ).toBe(true);
    });

    it("keeps `name: needs.` for a value no one has written a sentence for", () => {
      expect(reviewSaid({ needs: "something new" }, item)).toBe("Latex: something new.");
    });

    it("finds the plain values of a query, and an example of each built by CONCAT from its own pieces", () => {
      expect(
        needsIn(
          'BIND ("9999-12-31" AS ?to) BIND ("a" AS ?needs) BIND (IF(?x, "b", "c") AS ?needs) ' +
            '{ VALUES (?kind ?needs) { (cascade:K "d") } }' +
            'BIND (CONCAT("this is new ", STR(?n), IF(?n = 1, " one", " ones"), " on ", SUBSTR(STR(?d), 1, 10)) AS ?needs)',
        ),
      ).toEqual({ literals: ["a", "b", "c", "d"], concatenated: ["this is new 3 ones on 2024-05-01"] });
    });
  });

  describe("utcInstant(asOf)", () => {
    it("returns undefined, and does not throw, for text that is not an instant", () => {
      for (const text of ["x", "", "yesterday", "2024-13-45T00:00:00Z"])
        expect(utcInstant(text), JSON.stringify(text)).toBeUndefined();
    });

    it("returns an instant in UTC for one with a timezone", () => {
      expect(utcInstant("2024-02-01T09:00:00+02:00")).toBe("2024-02-01T07:00:00Z");
    });
  });

  describe("stepWhenSaid(step)", () => {
    it("says the day a new version arrived in words: `on 17 October 2026`", () => {
      expect(stepWhenSaid({ arrived: "2026-10-17T12:00:00" })).toBe("on 17 October 2026");
    });

    it("says the world's date a version's import answered as of, in the same words", () => {
      expect(stepWhenSaid({ arrived: "2026-10-17T12:00:00", asOf: "2025-02-01T23:59:59Z" })).toBe("as of 1 February 2025");
    });
  });

  describe("dayOrAsWritten(text)", () => {
    it("says a date and a time as the day in words", () => {
      expect(dayOrAsWritten("2024-02-01")).toBe("1 February 2024");
      expect(dayOrAsWritten("2024-02-01T07:00:00Z")).toBe("1 February 2024");
    });

    it("says text that is not a real day as it was written, and nothing for no text", () => {
      expect(dayOrAsWritten("2024-13-45")).toBe("2024-13-45");
      expect(dayOrAsWritten("soon")).toBe("soon");
      expect(dayOrAsWritten(undefined)).toBe("");
    });
  });

  describe("the codes a condition or procedure answer carries", () => {
    it("returns the one code a condition or a procedure row carries", () => {
      const answers = {
        "pod/My active conditions": [
          { entry: "c1", condition: "Asthma", conditionCode: "urn:test:icd/J45.909" },
        ],
        "pod/My procedures": [
          { entry: "p1", procedure: "Draw", procedureCode: "urn:test:sct/82078001" },
        ],
      };
      expect(codesOf(answers).sort()).toEqual(["urn:test:icd/J45.909", "urn:test:sct/82078001"]);
    });
  });

  describe("rowSaid(row)", () => {
    it("says a count of submitters under ten in words, with or without contributing ones", () => {
      const row = { variation: "v", classification: [] };
      expect(rowSaid({ ...row, submitters: 3 })).toBe("ClinVar today gives no classification, three submitters.");
      expect(rowSaid({ ...row, submitters: 1 })).toBe("ClinVar today gives no classification, one submitter.");
      expect(rowSaid({ ...row, submitters: 12 })).toBe("ClinVar today gives no classification, 12 submitters.");
    });
  });
});

/**
 * A pod's page, its entry in the sidebar and its tab name the pod as a person: the title the pod keeps, which may name
 * another person than the pod's name does, as a pod made without a title is titled for the person of the record brought
 * into it; else the pod's name capitalised.
 */
describe("Naming pods as a person says them · typedName(), personName()", () => {
  describe("given a pod that keeps a title", () => {
    it("returns the title as typed when it is the pod's name made into words", () => {
      const titles = new Map([["o-brien-mcdonald", "O'Brien McDonald"]]);
      expect(typedName("o-brien-mcdonald", titles)).toBe("O'Brien McDonald");
      expect(personName("o-brien-mcdonald", titles)).toBe("O'Brien McDonald");
    });

    it("returns the title when it names another person than the pod's name does, as the sample's does", () => {
      const sample = new Map([["priya-natarajan-eval-case", "Priya Natarajan"]]);
      expect(personName("priya-natarajan-eval-case", sample)).toBe("Priya Natarajan");
      const titled = new Map([["walker-test", "Ines Calloway"]]);
      expect(personName("walker-test", titled)).toBe("Ines Calloway");
    });

    it("returns the title with its spaces tidied", () => {
      expect(personName("walker-test", new Map([["walker-test", " Ines  Calloway "]]))).toBe("Ines Calloway");
    });
  });

  describe("given a pod that keeps no title, or one the page cannot read", () => {
    it("returns the pod's name with a capital on each word, for a pod's title is its own name then", () => {
      const titles = new Map([["rowan-ellery-marsh", "rowan-ellery-marsh"]]);
      expect(typedName("rowan-ellery-marsh", titles)).toBeUndefined();
      expect(personName("rowan-ellery-marsh", titles)).toBe("Rowan Ellery Marsh");
      expect(personName("rowan-ellery-marsh")).toBe("Rowan Ellery Marsh");
    });
  });

  describe("given two pods that keep one title, as a kit loaded again at another point does", () => {
    it("returns the title for the pod its slug names and the pod's name with capitals for the other, so the pods stay apart", () => {
      const copies = new Map([
        ["alex-rivera", "Alex Rivera"],
        ["alex-rivera-j24", "Alex Rivera"],
      ]);
      expect(personName("alex-rivera", copies)).toBe("Alex Rivera");
      expect(personName("alex-rivera-j24", copies)).toBe("Alex Rivera J24");
    });

    it("returns the title for a copy alone, for nothing else bears it", () => {
      expect(personName("alex-rivera-j24", new Map([["alex-rivera-j24", "Alex Rivera"]]))).toBe("Alex Rivera");
    });

    it("returns each pod's name with capitals when the title is the same but for case and spacing, no pod being named for it", () => {
      const copies = new Map([
        ["alex-rivera-j24", "Alex Rivera"],
        ["alex-rivera-j25", "ALEX  RIVERA"],
      ]);
      expect(personName("alex-rivera-j24", copies)).toBe("Alex Rivera J24");
      expect(personName("alex-rivera-j25", copies)).toBe("Alex Rivera J25");
    });

    it("returns each pod's name with capitals when two pods are titled for a person and neither is named for the title", () => {
      const copies = new Map([
        ["pod-a", "Sam Lee"],
        ["pod-b", "Sam Lee"],
      ]);
      expect(personName("pod-a", copies)).toBe("Pod A");
      expect(personName("pod-b", copies)).toBe("Pod B");
    });
  });

  describe("given a pod named for a title and a pod that keeps it, the first being held under its own name", () => {
    it("returns the pod's name with capitals for the second, whether the first has no title or is sealed, for either is held under its name", () => {
      const copies = new Map([
        ["alex-rivera", "alex-rivera"],
        ["alex-rivera-j24", "Alex Rivera"],
      ]);
      expect(personName("alex-rivera-j24", copies)).toBe("Alex Rivera J24");
      expect(personName("alex-rivera", copies)).toBe("Alex Rivera");
    });
  });

  describe("given pods whose titles are in a script the pod's name cannot be made from", () => {
    it("returns each title for two pods that keep different ones, though both slug to nothing", () => {
      const names = new Map([
        ["pod-1", "李明"],
        ["pod-2", "王芳"],
      ]);
      expect(personName("pod-1", names)).toBe("李明");
      expect(personName("pod-2", names)).toBe("王芳");
    });

    it("returns each pod's name with capitals for two pods that keep one such title, so the pods stay apart", () => {
      const names = new Map([
        ["pod-1", "李明"],
        ["pod-2", "李明"],
      ]);
      expect(personName("pod-1", names)).toBe("Pod 1");
      expect(personName("pod-2", names)).toBe("Pod 2");
    });
  });

  describe("keptTitle(pod, titles)", () => {
    it("returns the title a pod keeps with its words spaced once, and nothing for a pod held under its own name", () => {
      const sharing = new Map([
        ["pod-a", "Sam Lee"],
        ["pod-b", " Sam  Lee "],
        ["ada", "ada"],
      ]);
      expect(keptTitle("pod-b", sharing)).toBe("Sam Lee");
      expect(keptTitle("ada", sharing)).toBeUndefined();
      expect(keptTitle("pod-c", sharing)).toBeUndefined();
    });
  });
});
