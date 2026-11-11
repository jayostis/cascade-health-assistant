import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slug } from "../said.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Api, apiOver as over, seal as sealed } from "./sealed.ts";

let folder: string;
const made: Api[] = [];

const apiOver = (samples: string[] = []) => {
  const api = over(folder, samples);
  made.push(api);
  return api;
};
const seal = (api: Api, person: string) => sealed(api, person, slug(person));

const refusal = (error: unknown) => error as { name: string; message: string };

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "pods-test-"));
});

afterAll(async () => {
  for (const api of made) await api.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 5 });
});

/**
 * A pod is made, locked and unlocked through PodApi, and what it refuses is a sentence a person can act on: a sample is
 * never encrypted, and a pod's six words are checked on every call, not only on the first.
 */
describe("Making and unlocking pods · api.makePod(), api.unlock()", () => {
  describe("when `makePod` is asked to encrypt", () => {
    it("refuses a sample's name with a sentence that says samples are not encrypted, and loads nothing", async () => {
      const api = apiOver(["sample"]);
      const error = await api
        .makePod({ person: "Sample", encrypt: true })
        .catch(refusal);
      expect(error).toMatchObject({ name: "Refusal" });
      expect(error.message).toMatch(/sample/i);
      expect(error.message).toMatch(/encrypt/i);
      expect((await api.pods({})).pods.map(({ name }) => name)).not.toContain(
        "sample",
      );
    });

    it("refuses a sample that is already loaded, and leaves the pod as it was", async () => {
      const api = apiOver(["loaded"]);
      await api.makePod({ person: "Loaded" });
      const error = await api
        .makePod({ person: "Loaded", encrypt: true })
        .catch(refusal);
      expect(error).toMatchObject({ name: "Refusal" });
      expect(error.message).toMatch(/sample/i);
      expect((await api.pod({ pod: "loaded" })).encrypted).toBe(false);
    });

    it("refuses a pod that exists unencrypted, with a sentence that says so", async () => {
      const api = apiOver();
      await api.makePod({ person: "Plain" });
      const error = await api
        .makePod({ person: "Plain", encrypt: true })
        .catch(refusal);
      expect(error).toMatchObject({ name: "Refusal" });
      expect(error.message).toMatch(/exists already/);
      expect(error.message).toMatch(/not encrypted/);
    });
  });

  describe("given an encrypted pod that is already open", () => {
    const words = once(async () => {
      const api = apiOver();
      const six = await seal(api, "Ines Ward");
      return { api, six };
    });

    it("returns `opened: true` for its own six words", async () => {
      const { api, six } = await words();
      expect(await api.unlock({ pod: "ines-ward", secret: six })).toEqual({
        pod: "ines-ward",
        opened: true,
      });
    });

    it("throws `Unopened` with `incorrect secret` for other words", async () => {
      const { api } = await words();
      const error = await api
        .unlock({ pod: "ines-ward", secret: "not the words" })
        .catch((thrown: unknown) => thrown);
      expect(error).toMatchObject({
        name: "Unopened",
        outcome: "incorrect secret",
      });
    });

    it("throws `Unopened` with `incorrect secret` for no words", async () => {
      const { api } = await words();
      const error = await api
        .unlock({ pod: "ines-ward", secret: "" })
        .catch((thrown: unknown) => thrown);
      expect(error).toMatchObject({
        name: "Unopened",
        outcome: "incorrect secret",
      });
    });
  });

  describe("given a pod that is open and not encrypted", () => {
    it("returns `opened: true` whatever `secret` holds", async () => {
      const api = apiOver();
      await api.makePod({ person: "Open Pod" });
      expect(await api.unlock({ pod: "open-pod", secret: "any words" })).toEqual(
        { pod: "open-pod", opened: true },
      );
    });
  });

  describe("given a locked pod and two calls at the same moment", () => {
    it("answers each by its own secret: the right words open the pod, other words throw `Unopened`", async () => {
      const six = await seal(apiOver(), "Rowan Ellery");
      const fresh = apiOver();
      const [right, wrong] = await Promise.allSettled([
        fresh.unlock({ pod: "rowan-ellery", secret: six }),
        fresh.unlock({ pod: "rowan-ellery", secret: "not the words at all" }),
      ]);
      expect(right).toMatchObject({
        status: "fulfilled",
        value: { pod: "rowan-ellery", opened: true },
      });
      expect(wrong).toMatchObject({
        status: "rejected",
        reason: { name: "Unopened", outcome: "incorrect secret" },
      });
    });
  });
});

/** Runs `make` once, on the first call, and gives its promise to every call after. */
function once<T>(make: () => Promise<T>) {
  let made: Promise<T> | undefined;
  return () => (made ??= make());
}
