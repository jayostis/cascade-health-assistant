// Priya Natarajan's pod, the sample the app opens on: the downloads of the evals' case `priya-natarajan` in
// cascade-runtime-js, kept in `samples/priya-natarajan-eval-case/` as they were generated, and imported in the order
// the case imports them. The vocabulary kit's pod of the same person is a different pod, with nine downloads and none of
// the planted gaps.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { openPod } from "cascade-runtime";

export const SAMPLE = {
  /** The pod's folder name in `pods/`; the kit's pod is `priya-natarajan`. */
  pod: "priya-natarajan-eval-case",
  person: "Priya Natarajan",
  /** Where the downloads are. */
  downloads: fileURLToPath(
    new URL("samples/priya-natarajan-eval-case/", import.meta.url),
  ),
  /** The case's digest of them (`downloads.sha256` of its `case.json`): `digestOf` of the folder. */
  sha256: "e943c0c4c380fc21155c2faf3ceb4ec18a7c37623ec9887f2636c39a21ada394",
  /** The case's `imports`, in order. */
  imports: [
    "x-e2/apple_health_export",
    "kestrel-harbor-health-summary.xml",
    "kestrel-harbor-health-summary-2.xml",
    "kestrel-harbor-health-summary-3.xml",
    "fernhill-family-clinic-summary.xml",
    "x-e8/apple_health_export",
    "fernhill-family-clinic-summary-2.xml",
    "export_cda.xml",
    "kestrel-harbor-health-summary-4.xml",
    "saltmarsh-regional-medical-center-ed-summary.xml",
    "fernhill-family-clinic-summary-3.xml",
    "kestrel-harbor-health-summary-5.xml",
    "clearwater-eye-associates-visit-summary.xml",
    "northbay-clinical-laboratories-results.xml",
    "fernhill-family-clinic-summary-4.xml",
    "alder-street-pharmacy-patient-record.xml",
  ],
} as const;

/** The SHA-256 of the lines `<file's sha256>  <path>`, sorted by path: the evals' `digestOf`, `sha256sum` over the folder, hashed. */
export async function digestOf(folder: string): Promise<string> {
  const files = (await readdir(folder, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(folder, join(entry.parentPath, entry.name)).replaceAll("\\", "/"),
    )
    .sort();
  let lines = "";
  for (const file of files)
    lines += `${createHash("sha256")
      .update(await readFile(join(folder, file)))
      .digest("hex")}  ${file}\n`;
  return createHash("sha256").update(lines).digest("hex");
}

/** What importing the sample did, per download: the download refused is the one `refused` says why. */
export interface Imports {
  readonly download: string;
  readonly refused?: string;
}

/** Imports the sample's downloads, in order, into a new pod in `folder`. A download the runtime refuses is told, not thrown. */
export async function loadSample(
  folder: string,
  told?: (download: string) => void,
): Promise<Imports[]> {
  const pod = await openPod(folder, { title: SAMPLE.person });
  const done: Imports[] = [];
  try {
    for (const download of SAMPLE.imports) {
      told?.(download);
      const path = join(SAMPLE.downloads, download);
      try {
        await pod.look(path);
      } catch (error) {
        done.push({ download, refused: (error as Error).message });
        continue;
      }
      const imported = await pod.import(path, { claimProfiles: (named) => named });
      done.push({
        download,
        ...(imported.refused ? { refused: String(imported.refused) } : {}),
      });
    }
  } finally {
    await pod.close();
  }
  return done;
}
