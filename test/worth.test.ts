import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { nodeHost } from "../node-host.ts";
import { podApi } from "../pod-api.ts";
import { loadSample, SAMPLE } from "../sample.ts";
import { type Answers, REVIEW, SOURCES, worthALook } from "../said.ts";

const SHARED = "possibly the same medication";
const entryOf = (name: string) => `pod://p/clinical/medications.ttl#${name}`;
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

test("two codes each shared by records of several entries give one line each, and equal sentences are said once", () => {
  const answers: Answers = {
    [REVIEW]: [
      // Alder, in e1, e2 and e3: three records, a pair for each two of different entries.
      pair("e1", "Alder 5 MG", "r1", "r2"),
      pair("e1", "Alder 5 MG", "r1", "r3"),
      pair("e2", "Alder 5 mg", "r2", "r3"),
      // Birch, in e4 and e5: two records, the one pair.
      pair("e4", "Birch 10 MG", "r4", "r5"),
      // Two entries named alike that disagree on how severe their allergy is.
      ...["a1", "a2"].map((entry) => ({
        entry: `pod://p/clinical/allergies.ttl#${entry}`,
        entryLabel: "Allergy entry · Aspirin",
        needs: "members disagree on criticality",
      })),
    ],
    [SOURCES]: [
      from("e1", "r1", "Fernhill Family Clinic"),
      from("e2", "r2", "Kestrel Harbor Hospital"),
      from("e3", "r3", "Fernhill Family Clinic"),
      from("e4", "r4", "Alder Street Pharmacy"),
      from("e5", "r5", "Alder Street Pharmacy"),
    ],
  };
  expect(worthALook(answers)).toEqual([
    {
      sentence:
        "Alder 5 MG is recorded 3 times, from Fernhill Family Clinic and Kestrel Harbor Hospital, under one code, which Cascade keeps apart. Cascade cannot confirm that the shared code names one product, so they may or may not be the same.",
      entry: entryOf("e1"),
      tag: "Needs review",
    },
    {
      sentence:
        "Birch 10 MG is recorded 2 times, from Alder Street Pharmacy, under one code, which Cascade keeps apart. Cascade cannot confirm that the shared code names one product, so they may or may not be the same.",
      entry: entryOf("e4"),
      tag: "Needs review",
    },
    {
      sentence: "Sources disagree on how severe the Aspirin allergy is.",
      entry: "pod://p/clinical/allergies.ttl#a1",
      tag: "Needs review",
    },
  ]);
});

test("on Priya's eval pod each shared code gives exactly one line, with its count and its places", async () => {
  const folder = await mkdtemp(join(tmpdir(), "worth-test-"));
  try {
    await loadSample(join(folder, SAMPLE.pod));
    const api = podApi(nodeHost({ folder }));
    try {
      const { answers } = await api.answers({ pod: SAMPLE.pod });
      const lines = worthALook(answers).map(({ sentence }) =>
        sentence.replace(
          / under one code, which Cascade keeps apart\. Cascade cannot confirm that the shared code names one product, so they may or may not be the same\.$/,
          " [shared code]",
        ),
      );
      expect(lines).toEqual([
        "Claritin 10 MG Oral Tablet is recorded 5 times, from Clearwater Eye Associates and Fernhill Family Clinic [shared code]",
        "Amlodipine 5 MG Oral Tablet is recorded 7 times, from Alder Street Pharmacy, Clearwater Eye Associates, Fernhill Family Clinic, Kestrel Harbor Hospital and Saltmarsh Regional Medical Center [shared code]",
        "Hydrochlorothiazide 12.5 mg capsule is recorded 5 times, from Alder Street Pharmacy, Clearwater Eye Associates, Fernhill Family Clinic and Kestrel Harbor Hospital [shared code]",
        "Losartan 50 mg tablet is recorded 6 times, from Alder Street Pharmacy, Clearwater Eye Associates, Fernhill Family Clinic, Kestrel Harbor Hospital and Saltmarsh Regional Medical Center [shared code]",
        "Metformin ER 500 MG 24 HR Extended Release Oral Tablet is recorded 6 times, from Alder Street Pharmacy, Clearwater Eye Associates, Fernhill Family Clinic, Kestrel Harbor Hospital and Saltmarsh Regional Medical Center [shared code]",
      ]);
    } finally {
      await api.close();
    }
  } finally {
    await rm(folder, { recursive: true, force: true, maxRetries: 5 });
  }
}, 120_000);
