import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { demoFetch } from "@the-cascade-protocol/sandbox";
import { answerSignIn } from "@the-cascade-protocol/sandbox/testing";
import { loadHospital, type LoadedHospital } from "@the-cascade-protocol/sandbox/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { nodeHost } from "../node-host.ts";
import { type Hospitals, podApi } from "../pod-api.ts";

type Api = ReturnType<typeof podApi>;
type Closable = { close(): Promise<void> };

const PATIENT = "story-statin";
const NAME = "Ines Calloway";
const UNTITLED = "rowan-ellery-marsh";

let north: LoadedHospital;
const folders: string[] = [];

beforeAll(async () => {
  north = await loadHospital("cascade-north");
});

afterAll(async () => {
  for (const each of folders) await rm(each, { recursive: true, force: true, maxRetries: 5 });
});

/** Cascade North in the process, as a host's hospitals, its sign-in page answered as the patient `PATIENT`. */
function northHospitals(hospital: LoadedHospital = north): Hospitals {
  const fetch = demoFetch([{ ...hospital, autoApprove: undefined }], {
    fallback: async (input) => {
      throw new TypeError(`no route to ${String(input)}`);
    },
  });
  const row = {
    name: hospital.hospital.name,
    vendor: "demo",
    fhirBase: hospital.hospital.fhirBase,
  };
  return {
    directory: async () => [row],
    registration: {
      clientId: "cascade-app",
      redirectUri: "https://app.test.invalid/callback",
    },
    fetch,
    ready: async () => undefined,
    signIn: () => (authorize) => answerSignIn(fetch, authorize, PATIENT, "allow"),
    pullName: () => "north",
  };
}

/** `north` with the Patient's name written as `name` only. */
function northNamedOnlyByText(): LoadedHospital {
  const bundle = structuredClone(north.patients[PATIENT]!) as {
    entry: { resource: { resourceType: string; name?: object[] } }[];
  };
  for (const { resource } of bundle.entry)
    if (resource.resourceType === "Patient") resource.name = [{ text: NAME }];
  return { ...north, patients: { ...north.patients, [PATIENT]: bundle as never } };
}

/** `pod` with `result` laid over what its `import` says. */
const importing = (pod: Closable, result: object) =>
  new Proxy(pod, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === "import")
        return async (...args: unknown[]) => ({
          ...(await (value as (...a: unknown[]) => Promise<object>).apply(target, args)),
          ...result,
        });
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

/**
 * A pod brought a record of `PATIENT` at Cascade North through a PodApi, which is then closed; its title when a new
 * PodApi over the same folder lists the pods. `make` makes the pod, `result` is laid over what its import says.
 */
async function titleAfterBringIn(
  pod: string,
  make: (api: Api, at: string) => Promise<unknown>,
  { result, hospital }: { result?: object; hospital?: LoadedHospital } = {},
) {
  const at = await mkdtemp(join(tmpdir(), "bring-test-"));
  folders.push(at);
  const base = nodeHost({ folder: at });
  const local = podApi({
    ...base,
    pods: {
      ...base.pods,
      open: async (name, options) => {
        const opened = await base.pods.open(name, options);
        return result === undefined ? opened : (importing(opened, result) as typeof opened);
      },
    },
    hospitals: northHospitals(hospital),
  });
  await make(local, at);
  const { connection } = await local.connect({ pod, fhirBase: north.hospital.fhirBase });
  await local.connection({ pod, connection, wait: true });
  await local.bring({ pod, connection });
  await local.connection({ pod, connection, wait: true });
  await local.close();
  const again = podApi(nodeHost({ folder: at }));
  const { pods } = await again.pods({});
  await again.close();
  return pods.find(({ name }) => name === pod)!.title;
}

/** What the connection of a pod made by `make` says of whether the pod keeps a name, once the record is pulled. */
async function titledOnConnection(pod: string, make: (api: Api, at: string) => Promise<unknown>) {
  const at = await mkdtemp(join(tmpdir(), "bring-test-"));
  folders.push(at);
  const api = podApi({ ...nodeHost({ folder: at }), hospitals: northHospitals() });
  try {
    await make(api, at);
    const { connection } = await api.connect({ pod, fhirBase: north.hospital.fhirBase });
    const now = await api.connection({ pod, connection, wait: true });
    return { step: now.step, titled: now.titled };
  } finally {
    await api.close();
  }
}

/** A pod opened and closed, so the folder holds one with no name on file. */
const untitled = async (_: Api, at: string) => {
  const pod = await nodeHost({ folder: at }).pods.open(UNTITLED);
  await pod.close();
};

/**
 * Bringing a hospital's record into a pod claims its profile for the person the record is about. A pod that has no name
 * on file is then titled with that person's name, so the pods' list names the person and not the pod's folder.
 */
describe("Titling a pod after a hospital's record is brought in · api.bring()", () => {
  describe("given a pod with no name on file and a record of one person", () => {
    it("titles the pod with the person's name, still so when the app is closed and opened again", async () => {
      expect(await titleAfterBringIn(UNTITLED, untitled)).toBe(NAME);
    }, 60_000);
  });

  describe("given a pod made under a name and a record of another person", () => {
    it("keeps the name the pod was made under", async () => {
      expect(await titleAfterBringIn("ada", (api) => api.makePod({ person: "Ada" }))).toBe("Ada");
    }, 60_000);
  });

  describe("given a pod with no name on file and an import that is refused", () => {
    it("leaves the pod untitled", async () => {
      expect(
        await titleAfterBringIn(UNTITLED, untitled, { result: { refused: "not a record" } }),
      ).toBe(UNTITLED);
    }, 60_000);
  });

  describe("given a pod with no name on file and an import that claims no profile", () => {
    it("leaves the pod untitled", async () => {
      expect(await titleAfterBringIn(UNTITLED, untitled, { result: { claimedProfiles: [] } })).toBe(
        UNTITLED,
      );
    }, 60_000);
  });

  describe("given a pod with no name on file and a record whose Patient has only a name as text", () => {
    it("leaves the pod untitled and logs no error", async () => {
      const logged = vi.spyOn(globalThis.console, "error").mockImplementation(() => undefined);
      try {
        const title = await titleAfterBringIn(UNTITLED, untitled, {
          hospital: northNamedOnlyByText(),
          result: { claimedProfiles: ["claimed"] },
        });
        expect(title).toBe(UNTITLED);
        expect(logged).not.toHaveBeenCalled();
      } finally {
        logged.mockRestore();
      }
    }, 60_000);
  });

  describe("when the connection of a pod is read once its record is pulled", () => {
    it("says the pod is titled when it was made under a name, which bringing the record in leaves", async () => {
      expect(await titledOnConnection("ada", (api) => api.makePod({ person: "Ada" }))).toEqual({
        step: "pulled",
        titled: true,
      });
    }, 60_000);

    it("says the pod is not titled when it has no name on file, which bringing the record in gives", async () => {
      expect(await titledOnConnection(UNTITLED, untitled)).toEqual({ step: "pulled", titled: false });
    }, 60_000);
  });
});
