import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeHost } from "../node-host.ts";
import { podApi } from "../pod-api.ts";
import { slug } from "../said.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Api, apiOver as over, seal as sealed } from "./sealed.ts";

let folder: string;
const made: Api[] = [];

const apiOver = (samples: string[] = [], opened?: { calls: number }) => {
  const api = over(folder, samples, opened);
  made.push(api);
  return api;
};
const seal = (api: Api, person: string) => sealed(api, person, slug(person));

/** What `call` throws; the test fails when it throws nothing. */
const thrown = (call: Promise<unknown>) =>
  call.then(
    () => {
      throw new Error("it did not throw");
    },
    (error: unknown) => error as { name: string; message: string },
  );

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
      const error = await thrown(api.makePod({ person: "Sample", encrypt: true }));
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
      const error = await thrown(api.makePod({ person: "Loaded", encrypt: true }));
      expect(error).toMatchObject({ name: "Refusal" });
      expect(error.message).toMatch(/sample/i);
      expect((await api.pod({ pod: "loaded" })).encrypted).toBe(false);
    });

    it("refuses a pod that exists unencrypted, with a sentence that says so", async () => {
      const api = apiOver();
      await api.makePod({ person: "Plain" });
      const error = await thrown(api.makePod({ person: "Plain", encrypt: true }));
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
      const error = await thrown(api.unlock({ pod: "ines-ward", secret: "not the words" }));
      expect(error).toMatchObject({ outcome: "incorrect secret" });
    });

    it("throws `Unopened` with `incorrect secret` for no words", async () => {
      const { api } = await words();
      const error = await thrown(api.unlock({ pod: "ines-ward", secret: "" }));
      expect(error).toMatchObject({ outcome: "incorrect secret" });
    });
  });

  describe("given an encrypted pod that is open and a secret to check", () => {
    it("opens no pod to check the words, the right ones or the wrong ones", async () => {
      const opened = { calls: 0 };
      const api = apiOver([], opened);
      const six = await seal(api, "Ada Wren");
      const before = opened.calls;
      expect(await api.unlock({ pod: "ada-wren", secret: six })).toEqual({
        pod: "ada-wren",
        opened: true,
      });
      const error = await thrown(api.unlock({ pod: "ada-wren", secret: "not the words at all" }));
      expect(error).toMatchObject({ outcome: "incorrect secret" });
      expect(opened.calls).toBe(before);
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
        reason: { outcome: "incorrect secret" },
      });
    });

    it("keeps one opening and closes the other of two calls at the same moment with the right words", async () => {
      const six = await seal(apiOver(), "Tess Quill");
      const host = nodeHost({ folder });
      const seen = { opens: 0, closes: 0, begun: 0 };
      let release!: () => void;
      const gate = new Promise<void>((done) => (release = done));
      const holding = podApi({
        ...host,
        pods: {
          ...host.pods,
          open: async (name, options) => {
            if (options?.secret !== undefined) {
              seen.begun += 1;
              await gate;
            }
            const pod = await host.pods.open(name, options);
            seen.opens += 1;
            const close = pod.close.bind(pod);
            pod.close = async () => {
              seen.closes += 1;
              return close();
            };
            return pod;
          },
        },
      });
      made.push(holding);
      const calls = Promise.all([
        holding.unlock({ pod: "tess-quill", secret: six }),
        holding.unlock({ pod: "tess-quill", secret: six }),
      ]);
      while (seen.begun < 2) await new Promise((tick) => setTimeout(tick, 5));
      release();
      expect(await calls).toEqual([
        { pod: "tess-quill", opened: true },
        { pod: "tess-quill", opened: true },
      ]);
      expect(seen.opens - seen.closes, `${seen.opens} openings, ${seen.closes} closed`).toBe(1);
    });
  });
});

/** Runs `make` once, on the first call, and gives its promise to every call after. */
function once<T>(make: () => Promise<T>) {
  let made: Promise<T> | undefined;
  return () => (made ??= make());
}
