import { describe, expect, it } from "vitest";
import { type Answers, REVIEW, SOURCES, worthALook } from "../said.ts";

const SHARED = "possibly the same medication";
const entryOf = (name: string) => `pod://p/clinical/medications.ttl#${name}`;
const allergyOf = (name: string) => `pod://p/clinical/allergies.ttl#${name}`;
const record = (name: string) => `urn:uuid:${name}`;

/** One row of What needs review for a pair of medication records, the first in `entry`, as the query gives it. */
const pair = (entry: string, name: string, a: string, b: string) => ({
  entry: entryOf(entry),
  entryLabel: `Medication entry · ${name}`,
  needs: SHARED,
  record: record(a),
  recordLabel: `Medication · ${name} · Somewhere`,
  otherRecord: record(b),
  otherRecordLabel: `Medication · ${name} · Somewhere`,
});

/** A row of Where it came from: `record` of `entry`, from `hospital`. */
const from = (entry: string, rec: string, hospital: string) => ({
  entry: entryOf(entry),
  record: record(rec),
  hospital,
});

/** A row of What needs review for an allergy whose sources disagree on how severe it is. */
const disagreeing = (entry: string, entryLabel: string) => ({
  entry: allergyOf(entry),
  entryLabel,
  needs: "members disagree on criticality",
});

const SHARING =
  "; some of these records share a code but Cascade keeps them apart. Cascade cannot confirm that a shared code names one product, so they may or may not be the same.";

/**
 * On a pod's page the app lists what needs the person's review, each line a sentence about one view entry, written from
 * the rows of `entry/What needs review`. That question returns a row for every pair of records, so the app says each thing
 * once and claims no more than the rows show.
 */
describe("Listing what is worth a look in a pod · worthALook()", () => {
  const answers: Answers = {
    [REVIEW]: [
      // Alder, in e1, e2 and e3: three records, a pair for each two of different entries.
      pair("e1", "Alder 5 MG", "r1", "r2"),
      pair("e1", "Alder 5 MG", "r1", "r3"),
      pair("e2", "Alder 5 mg", "r2", "r3"),
      // Birch, in e4 and e5: two records, the one pair.
      pair("e4", "Birch 10 MG", "r4", "r5"),
      // Two entries named alike that disagree on how severe their allergy is.
      disagreeing("a1", "Allergy entry · Aspirin"),
      disagreeing("a2", "Allergy entry · Aspirin"),
    ],
    [SOURCES]: [
      from("e1", "r1", "Fernhill Family Clinic"),
      from("e2", "r2", "Kestrel Harbor Hospital"),
      from("e3", "r3", "Fernhill Family Clinic"),
      from("e4", "r4", "Alder Street Pharmacy"),
      from("e5", "r5", "Alder Street Pharmacy"),
    ],
  };
  const lines = worthALook(answers);
  const medications = lines.filter(({ sentence }) => sentence.includes(" is recorded "));

  describe("given medications whose records share a code", () => {
    it("says one line for a code that records of three view entries share, about the first view entry", () => {
      const alder = lines.filter(({ sentence }) => sentence.startsWith("Alder 5 MG"));
      expect(alder.map(({ entry }) => entry)).toEqual([entryOf("e1")]);
    });

    it("says a line for each shared code", () => {
      expect(medications.map(({ sentence }) => sentence.split(" is recorded ")[0])).toEqual([
        "Alder 5 MG",
        "Birch 10 MG",
      ]);
      expect(medications[1]!.entry).toBe(entryOf("e4"));
    });

    it("counts the records and names each place they came from once", () => {
      // Fernhill once, though two of Alder's records came from it.
      expect(medications.map(({ sentence }) => sentence)).toEqual([
        `Alder 5 MG is recorded 3 times, from Fernhill Family Clinic and Kestrel Harbor Hospital${SHARING}`,
        `Birch 10 MG is recorded 2 times, from Alder Street Pharmacy${SHARING}`,
      ]);
    });

    it("says one line for records connected through two different codes, and only that some of them share a code", () => {
      expect(
        worthALook({
          [REVIEW]: [
            // A and B share one code, B and C another: no one code names all three.
            pair("e1", "Cedar 5 MG", "r1", "r2"),
            pair("e2", "Cedar 5 MG", "r2", "r3"),
          ],
          [SOURCES]: [
            from("e1", "r1", "Fernhill Family Clinic"),
            from("e2", "r2", "Kestrel Harbor Hospital"),
            from("e3", "r3", "Fernhill Family Clinic"),
          ],
        }),
      ).toEqual([
        {
          sentence: `Cedar 5 MG is recorded 3 times, from Fernhill Family Clinic and Kestrel Harbor Hospital${SHARING}`,
          entry: entryOf("e1"),
          tag: "Needs review",
        },
      ]);
    });

    it("tags each line `Needs review`", () => {
      expect(lines.length).toBeGreaterThan(0);
      for (const { sentence, tag } of lines) expect(tag, sentence).toBe("Needs review");
    });
  });

  describe("given allergies whose sources disagree on how severe they are", () => {
    it("says a line for each view entry, though the two sentences are the same", () => {
      const allergies = lines.filter(({ entry }) => entry.includes("allergies.ttl"));
      expect(allergies).toEqual([
        { sentence: "Sources disagree on how severe the Aspirin allergy is.", entry: allergyOf("a1"), tag: "Needs review" },
        { sentence: "Sources disagree on how severe the Aspirin allergy is.", entry: allergyOf("a2"), tag: "Needs review" },
      ]);
    });

    it("says `an unnamed entry` for a view entry whose label is empty", () => {
      const unnamed = worthALook({ [REVIEW]: [disagreeing("a1", ""), disagreeing("a2", "")] });
      expect(unnamed.map(({ entry, sentence }) => [entry, sentence])).toEqual([
        [allergyOf("a1"), "Sources disagree on how severe an unnamed entry is."],
        [allergyOf("a2"), "Sources disagree on how severe an unnamed entry is."],
      ]);
    });

    it("says `an unnamed allergy` for a label of the vocabulary that has a kind and no name", () => {
      const unnamed = worthALook({ [REVIEW]: [disagreeing("a1", "Allergy entry")] });
      expect(unnamed.map(({ sentence }) => sentence)).toEqual(["Sources disagree on how severe an unnamed allergy is."]);
    });
  });
});
