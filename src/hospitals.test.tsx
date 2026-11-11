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
});
