import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { ConnectionNow } from "./api.tsx";
import { patientName } from "../said.ts";
import { ConnectionBox } from "./hospitals.tsx";

/** A pulled connection to a hospital, with what `changes` says of it. */
const pulled = (changes: Partial<ConnectionNow> = {}) =>
  ({
    n: 1,
    row: { name: "Cascade North Demo Hospital", fhirBase: "https://north.test/fhir" },
    step: "pulled",
    settled: true,
    requests: 1,
    sources: [{ records: { Condition: 2 }, holdsSubjectsRecords: false }],
    pulled: { missing: [], denied: [] },
    ...changes,
  }) as unknown as ConnectionNow;

/** The words of the box over `pod`, with its button's label apart. */
function boxOver(pod: string, connection: ConnectionNow, titles?: ReadonlyMap<string, string>) {
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <ConnectionBox
          pod={pod}
          titles={titles}
          connection={connection}
          back="#"
          signInAgain={() => null}
        />
      ),
    },
  ]);
  const html = renderToStaticMarkup(<RouterProvider router={router} />);
  const text = (markup: string) =>
    markup
      .replace(/<[^>]*>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  const buttons = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)];
  return { said: text(html), button: text(buttons.at(-1)?.[1] ?? "") };
}

/**
 * The box over a pod's page follows a connection to a hospital until its record is here, then says what the hospital has
 * and offers to bring it in, naming one person: whose pod the record would make, never two at once.
 */
describe("Bringing a hospital's record into a pod · ConnectionBox", () => {
  describe("given a pulled record and a pod whose person is known", () => {
    it("says `This pod has nothing from here yet`, naming the person on the button only", () => {
      const { said, button } = boxOver("alex-rivera", pulled());
      expect(said).toContain("This pod has nothing from here yet.");
      expect(said).not.toContain("Alex Rivera's pod has");
      expect(button).toBe("Bring it into Alex Rivera's pod");
    });

    it("says `This pod already has records from here` when the pod holds the subject's records", () => {
      const { said } = boxOver(
        "alex-rivera",
        pulled({ sources: [{ records: { Condition: 2 }, holdsSubjectsRecords: true }] }),
      );
      expect(said).toContain("This pod already has records from here.");
      expect(said).not.toContain("Alex Rivera's pod already");
    });
  });

  describe("given a record of one person and a pod that has no title", () => {
    it("names the record's person on the button, never the pod's slug name", () => {
      const { said, button } = boxOver(
        "rowan-ellery-marsh",
        pulled({ patient: "Odalys Brandt", patientNames: [{ name: "Odalys Brandt", family: "Brandt" }] }),
      );
      expect(said).toContain("This record is Odalys Brandt's. Bringing it in makes this Odalys Brandt's pod.");
      expect(said).toContain("This pod has nothing from here yet.");
      expect(said).not.toContain("Rowan");
      expect(button).toBe("Bring it into Odalys Brandt's pod");
    });
  });

  describe("given a Patient whose official name has only text", () => {
    const bundle = {
      entry: [{ resource: { resourceType: "Patient", name: [{ use: "official", text: "Ines Calloway" }] } }],
    } as unknown as Parameters<typeof patientName>[0];

    it("names no person, for an empty name is no name", () => {
      expect(patientName(bundle)).toBeUndefined();
      expect(patientName({ entry: [{ resource: { resourceType: "Patient", name: [{ given: [" "] }] } }] } as never)).toBeUndefined();
    });

    it("says no `This record is` line for the record", () => {
      const { said } = boxOver("rowan-ellery-marsh", pulled({ patient: patientName(bundle) }));
      expect(said).not.toContain("This record is");
    });
  });

  describe("given a pulled record with no patient and a pod that has no title", () => {
    it("names the pod's slug name on the button", () => {
      const { said, button } = boxOver(
        "alex-rivera",
        pulled({ sources: [{ records: {}, holdsSubjectsRecords: false }] }),
      );
      expect(button).toBe("Bring it into Alex Rivera's pod");
      expect(said).toContain("This pod has nothing from here yet.");
    });
  });

  describe("given a pod that keeps a title and a record of another person", () => {
    const ROWAN = "Rowan Ellery Marsh";
    const KEEPS = "Bringing it in leaves this pod named";
    const of = (given: string, family: string) =>
      boxOver(
        "rowan-ellery-marsh",
        pulled({ patient: `${given} ${family}`, patientNames: [{ name: `${given} ${family}`, family }] }),
        new Map([["rowan-ellery-marsh", ROWAN]]),
      );

    it("says whose record it is, not the pod's person's, and that the pod keeps its name, when no word of the names is shared", () => {
      const { said, button } = of("Odalys", "Brandt");
      expect(said).toContain("This record is Odalys Brandt's, not Rowan Ellery Marsh's.");
      expect(said).toContain(`${KEEPS} ${ROWAN}.`);
      expect(button).toBe("Bring Odalys Brandt's records into Rowan Ellery Marsh's pod anyway");
    });

    it("says whose record it is and that the pod keeps its name, when only the family name is shared", () => {
      const { said, button } = of("Moss", "Marsh");
      expect(said).toContain("This record is Moss Marsh's.");
      expect(said).toContain(`${KEEPS} ${ROWAN}.`);
      expect(said).not.toContain("not Rowan");
      expect(button).toBe("Bring Moss Marsh's records into Rowan Ellery Marsh's pod");
    });

    it("says nothing of whose record it is when the record is the pod's person's", () => {
      const { said, button } = of("Rowan Ellery", "Marsh");
      expect(said).not.toContain("This record is");
      expect(said).not.toContain(KEEPS);
      expect(button).toBe("Bring it into Rowan Ellery Marsh's pod");
    });

    it("never says that bringing the record in makes the pod the record's person's", () => {
      expect(of("Odalys", "Brandt").said).not.toContain("makes this");
    });
  });

  describe("given a pod whose title is kept and the page shows another name for it, as two pods keeping one title are shown", () => {
    it("grades the record against the title the pod keeps, so the pod's own person's record raises no warning", () => {
      const sam = pulled({ patient: "Sam Lee", patientNames: [{ name: "Sam Lee", family: "Lee" }] });
      const titles = new Map([
        ["pod-a", "Sam Lee"],
        ["pod-b", "Sam Lee"],
      ]);
      const { said, button } = boxOver("pod-b", sam, titles);
      expect(said).not.toContain("This record is");
      expect(said).not.toContain("makes this");
      expect(button).toBe("Bring it into Pod B's pod");
    });

    it("grades a kit's copy against the kit's title, which the original pod's own name does not carry", () => {
      const alex = pulled({ patient: "Alex Rivera", patientNames: [{ name: "Alex Rivera", family: "Rivera" }] });
      const titles = new Map([
        ["alex-rivera", "alex-rivera"],
        ["alex-rivera-j24", "Alex Rivera"],
      ]);
      const { said, button } = boxOver("alex-rivera-j24", alex, titles);
      expect(said).not.toContain("This record is");
      expect(button).toBe("Bring it into Alex Rivera J24's pod");
    });
  });

  describe("given a pod that keeps a title other pods share, so the page shows the pod's name", () => {
    const sharing = (patient: string, family: string, patientNames = [{ name: patient, family }]) =>
      boxOver(
        "pod-b",
        pulled({ patient, patientNames }),
        new Map([
          ["pod-a", "Sam Lee"],
          ["pod-b", "Sam Lee"],
        ]),
      ).said;

    it("names the title the pod keeps, not the name the page shows, in the warning for another person's record", () => {
      expect(sharing("Odalys Brandt", "Brandt")).toContain(
        "This record is Odalys Brandt's, not Sam Lee's. Bringing it in leaves this pod named Sam Lee.",
      );
    });

    it("names the title the pod keeps when the record names no one to grade", () => {
      expect(sharing("Odalys Brandt", "Brandt", [])).toContain(
        "This record is Odalys Brandt's. Bringing it in leaves this pod named Sam Lee.",
      );
    });
  });

  describe("given a pod that keeps a title the page cannot read, as an encrypted pod's is sealed", () => {
    const ines = {
      patient: "Ines Calloway",
      patientNames: [{ name: "Ines Calloway", family: "Calloway" }],
    };
    const sealed = new Map([["cy-sealed", "cy-sealed"]]);

    it("says whose record it is and that the pod keeps its name, naming the pod's person on the button", () => {
      const { said, button } = boxOver("cy-sealed", pulled({ ...ines, titled: true }), sealed);
      expect(said).toContain(
        "This record is Ines Calloway's, not Cy Sealed's. Bringing it in leaves this pod named Cy Sealed.",
      );
      expect(said).not.toContain("makes this");
      expect(button).toBe("Bring Ines Calloway's records into Cy Sealed's pod anyway");
    });

    it("says that the pod keeps its name when the record names no one to grade, and never makes the pod the record's person's", () => {
      const { said, button } = boxOver("cy-sealed", pulled({ ...ines, patientNames: [], titled: true }), sealed);
      expect(said).toContain("This record is Ines Calloway's. Bringing it in leaves this pod named Cy Sealed.");
      expect(said).not.toContain("makes this");
      expect(button).toBe("Bring it into Cy Sealed's pod");
    });

    it("says the record makes the pod its person's when the connection does not say the pod is titled", () => {
      const { said } = boxOver("cy-sealed", pulled(ines), sealed);
      expect(said).toContain("Bringing it in makes this Ines Calloway's pod.");
    });
  });
});
