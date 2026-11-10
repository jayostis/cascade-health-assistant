import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nodeHost } from "../node-host.ts";
import { podApi } from "../pod-api.ts";
import { digestOf, loadSample, SAMPLE } from "../sample.ts";
import { worthALook } from "../said.ts";

type Answers = Awaited<ReturnType<ReturnType<typeof podApi>["answers"]>>["answers"];

/** What the one load of the sample, in a folder of its own, left: `loadSample`'s lines, the pod's api and its answers. */
interface Loaded {
  readonly folder: string;
  readonly done: Awaited<ReturnType<typeof loadSample>>;
  readonly api: ReturnType<typeof podApi>;
  readonly answers: Answers;
}

// The sample takes seconds to load, so the file loads it once, when the first describe that reads it begins.
let loading: Promise<Loaded> | undefined;
const loaded = (): Promise<Loaded> => (loading ??= load());

async function load(): Promise<Loaded> {
  const folder = await mkdtemp(join(tmpdir(), "sample-test-"));
  const done = await loadSample(join(folder, SAMPLE.pod));
  const api = podApi(nodeHost({ folder }));
  const { answers } = await api.answers({ pod: SAMPLE.pod });
  return { folder, done, api, answers };
}

afterAll(async () => {
  if (loading === undefined) return;
  const { folder, api } = await loading.catch(() => ({ folder: undefined, api: undefined }));
  await api?.close();
  if (folder !== undefined) await rm(folder, { recursive: true, force: true, maxRetries: 5 });
});

/**
 * A new clone has no pods, so the app makes one: Priya Natarajan's, from the sixteen downloads of the evals' case kept in
 * `samples/`. The chat's tests and a first `npm start` both rest on it, so it has to load the same way every time.
 */
describe("Loading the sample pod the app opens on · loadSample(), SAMPLE", () => {
  describe("loadSample(folder)", () => {
    let sample: Loaded;
    beforeAll(async () => {
      sample = await loaded();
    }, 120_000);

    it("returns a line for each download of `SAMPLE.imports`, in the order the case imports them", () => {
      expect(sample.done.map(({ download }) => download)).toEqual([...SAMPLE.imports]);
    });

    it("returns `refused` for the two downloads the case plants to be refused, and for no other", () => {
      expect(
        sample.done.filter(({ refused }) => refused !== undefined).map(({ download }) => download),
      ).toEqual(["export_cda.xml", "kestrel-harbor-health-summary-4.xml"]);
    });

    it("makes a pod that PodApi lists as `SAMPLE.pod`", async () => {
      const { pods } = await sample.api.pods();
      expect(pods.map(({ name }) => name)).toEqual([SAMPLE.pod]);
    });

    it("makes a pod whose `pod/What each import brought in` has rows", () => {
      expect(sample.answers["pod/What each import brought in"].length).toBeGreaterThan(0);
    });
  });
});

describe("The sample's downloads, as the evals' case has them", () => {
  it("hashes to `SAMPLE.sha256`, the digest the case records", async () => {
    expect(await digestOf(SAMPLE.downloads)).toBe(SAMPLE.sha256);
  });
});

// Its description is in worth.test.ts; these two read the sample pod, which this file loads.
describe("Listing what is worth a look in a pod · worthALook()", () => {
  describe("given the sample pod", () => {
    let lines: ReturnType<typeof worthALook>;
    beforeAll(async () => {
      lines = worthALook((await loaded()).answers);
    }, 120_000);

    it("says one line for each medication whose records share a code, none twice", () => {
      const names = lines.map(({ sentence }) => sentence.split(" is recorded ")[0]);
      expect(lines.length).toBeGreaterThan(1);
      for (const { sentence } of lines)
        expect(sentence, sentence).toMatch(
          /^.+ is recorded \d+ times, from .+; some of these records share a code but Cascade keeps them apart\./,
        );
      expect(new Set(names).size, names.join(", ")).toBe(names.length);
    });

    it("says that amlodipine `is recorded 7 times`, with the five sources its records came from", () => {
      const amlodipine = lines.filter(({ sentence }) => sentence.startsWith("Amlodipine"));
      expect(amlodipine.map(({ sentence }) => sentence.split(";")[0])).toEqual([
        "Amlodipine 5 MG Oral Tablet is recorded 7 times, from Alder Street Pharmacy, Clearwater Eye Associates, Fernhill Family Clinic, Kestrel Harbor Hospital and Saltmarsh Regional Medical Center",
      ]);
    });
  });
});
