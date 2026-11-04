import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { bundleText, fromSynthea, generatedPerson, medicationRows, providerDetails, } from "./synthea.js";
const PACKAGE = fileURLToPath(new URL("../../../", import.meta.url));
const HOSPITALS = join(PACKAGE, "hospitals");
const PEOPLE = join(PACKAGE, "people");
async function readJson(path) {
    return JSON.parse(await readFile(path, "utf8"));
}
/** Removes every person folder `npm run synthea` wrote before, which its `person.json` says by `generated`. */
async function removeGenerated() {
    for (const entry of await readdir(PEOPLE, { withFileTypes: true })) {
        if (!entry.isDirectory())
            continue;
        const folder = join(PEOPLE, entry.name);
        const person = await readJson(join(folder, "person.json")).catch(() => ({}));
        if (person.generated !== undefined)
            await rm(folder, { recursive: true, force: true });
    }
}
async function main(output) {
    const fhir = join(output, "fhir");
    const files = await readdir(fhir);
    const providers = [];
    for (const file of files.filter((name) => name.startsWith("hospitalInformation") ||
        name.startsWith("practitionerInformation"))) {
        const bundle = await readJson(join(fhir, file));
        providers.push(...(bundle.entry ?? []).flatMap((entry) => entry.resource ?? []));
    }
    const people = await readJson(join(PACKAGE, "synthea", "people.json"));
    const hospitals = new Map();
    for (const folder of new Set(people.flatMap((person) => person.hospitals))) {
        const hospital = await readJson(join(HOSPITALS, folder, "hospital.json"));
        hospitals.set(folder, { folder, hospital });
    }
    const stops = await readFile(join(output, "csv", "medications.csv"), "utf8");
    const written = [];
    for (const chosen of people) {
        const file = files.find((name) => name.endsWith(`_${chosen.synthea}.json`));
        if (!file)
            throw new Error(`No Synthea output for ${chosen.synthea}`);
        written.push({
            chosen,
            sources: fromSynthea(await readJson(join(fhir, file)), chosen.hospitals.map((folder) => hospitals.get(folder)), medicationRows(stops, chosen.synthea)),
        });
    }
    await removeGenerated();
    for (const { chosen, sources } of written) {
        const folder = join(PEOPLE, chosen.person);
        for (const { folder: hospital, bundle } of sources) {
            await mkdir(join(folder, "sources", hospital), { recursive: true });
            await writeFile(join(folder, "sources", hospital, "fhir.json"), bundleText(bundle));
        }
        await writeFile(join(folder, "person.json"), `${JSON.stringify(generatedPerson(chosen, sources[0].bundle), null, 2)}\n`);
    }
    await writeFile(join(PACKAGE, "synthea", "removed.json"), `${JSON.stringify(providerDetails(providers), null, 2)}\n`);
}
const { positionals: [output], } = parseArgs({ allowPositionals: true });
if (!output) {
    console.error("usage: npm run synthea -- <Synthea output folder>");
    process.exitCode = 2;
}
else {
    await main(output);
}
//# sourceMappingURL=synthea-cli.js.map