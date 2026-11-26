// What the pod holds of the field a fact names, as a person reads it. The runtime's `held` lines are the pod's own
// words: `S3: structuredDosage 1/dosageDoseQuantity: unitText tablet, writtenValue 2`, a field's rows on a part of
// the record, or a field's value alone. A dosage reads as a dose; any other field as its name in words and its value.

/** A line of `held` as the person reads it, and the short names of the sources it is from (none when there is one source). */
export interface HeldLine {
  readonly text: string;
  readonly by: readonly string[];
}

type Pairs = readonly (readonly [name: string, value: string])[];
interface Parsed {
  readonly by: readonly string[];
  readonly part?: string;
  readonly pairs: Pairs;
  readonly plain: string;
}

const NAME = "[a-z][A-Za-z]*";
const SEGMENT = `${NAME}(?: \\d+)?`;
const BY = /^(S\d+(?:, S\d+)*): /;
const PART = new RegExp(`^(${SEGMENT}(?:/${SEGMENT})*): (.+)$`);
const PAIR = new RegExp(`^(${NAME}) (.*)$`);

/** `dispenseDaysSupply` as "dispense days supply". */
const words = (name: string) => name.replace(/([A-Z])/g, " $1").toLowerCase();

const PERIODS: Record<string, string> = {
  s: "second",
  min: "minute",
  h: "hour",
  d: "day",
  wk: "week",
  mo: "month",
  a: "year",
};

/** A coded value as its label alone: `Oral route (snomed:26643006)` is "Oral route". */
const labelOf = (value: string) => value.replace(/ \([a-z][\w-]*:[^()\s]+\)$/, "");

function parse(line: string): Parsed {
  const by = BY.exec(line);
  const rest = by === null ? line : line.slice(by[0].length);
  const part = PART.exec(rest);
  const pairs =
    part === null
      ? []
      : part[2]!.split(new RegExp(`, (?=${NAME} )`)).map((pair) => PAIR.exec(pair));
  return pairs.length > 0 && pairs.every((pair) => pair !== null)
    ? {
        by: by === null ? [] : by[1]!.split(", "),
        part: part![1]!,
        pairs: pairs.map((pair) => [pair![1]!, pair![2]!] as const),
        plain: rest,
      }
    : { by: by === null ? [] : by[1]!.split(", "), pairs: [], plain: rest };
}

const lastOf = (part: string) => part.split("/").pop()!.replace(/ \d+$/, "");
const valueOf = (pairs: Pairs, name: string) => pairs.find(([each]) => each === name)?.[1];

/** A quantity (`writtenValue 2, unitText tablet`) as "2 tablet", then what else the part holds, in words. */
function quantityAndRest(pairs: Pairs) {
  const unit = valueOf(pairs, "unitText");
  const written = valueOf(pairs, "writtenValue");
  return [
    written === undefined ? undefined : [written, unit].filter((part) => part !== undefined).join(" "),
    ...pairs
      .filter(([name]) => written === undefined || (name !== "writtenValue" && name !== "unitText"))
      .map(([name, value]) => `${words(name)} ${labelOf(value)}`),
  ].filter((part) => part !== undefined);
}

/** How often, from `dosageRepeatFrequency 3, dosageRepeatPeriod 1, dosageRepeatPeriodUnit d`: "3 per 1 day". */
function often(pairs: Pairs) {
  const times = valueOf(pairs, "dosageRepeatFrequency");
  const every = valueOf(pairs, "dosageRepeatPeriod");
  const unit = valueOf(pairs, "dosageRepeatPeriodUnit");
  if (times === undefined) return undefined;
  const period = unit === undefined ? "" : (PERIODS[unit] ?? unit);
  return `${times} per ${[every, every === "1" || period === "" ? period : `${period}s`].filter((part) => part !== undefined && part !== "").join(" ")}`;
}

const SCHEDULE = new Set(["dosageRepeatFrequency", "dosageRepeatPeriod", "dosageRepeatPeriodUnit", "dosageRouteCode"]);

/** A dosage's lines, drawn as one: the line of the dosage itself and the line of its dose. */
interface Dosage {
  readonly by: readonly string[];
  head: Pairs;
  dose: Pairs;
}

const dosageText = ({ head, dose }: Dosage) => {
  const route = valueOf(head, "dosageRouteCode");
  return `Dose: ${[
    ...quantityAndRest(dose),
    often(head),
    route === undefined ? undefined : labelOf(route),
    ...head.filter(([name]) => !SCHEDULE.has(name)).map(([name, value]) => `${words(name)} ${value}`),
  ]
    .filter((part) => part !== undefined)
    .join(" · ")}`;
};

/**
 * The lines of `held` as a person reads them. A dosage's lines are drawn as one: the dose, how often, the route. A
 * field's value alone has its name from `property`, the field the fact names.
 */
export function heldLines(held: readonly string[], property: string): HeldLine[] {
  const lines: (HeldLine | Dosage)[] = [];
  const dosages = new Map<string, Dosage>();
  for (const { by, part, pairs, plain } of held.map(parse)) {
    if (part === undefined) {
      lines.push({ text: `${words(property)}: ${labelOf(plain)}`, by });
      continue;
    }
    const root = part.split("/")[0]!;
    if (lastOf(root) !== "structuredDosage" || (part !== root && lastOf(part) !== "dosageDoseQuantity")) {
      lines.push({ text: `${words(lastOf(part))}: ${quantityAndRest(pairs).join(" · ")}`, by });
      continue;
    }
    const key = `${by.join(",")}|${root}`;
    let dosage = dosages.get(key);
    if (dosage === undefined) {
      dosage = { by, head: [], dose: [] };
      dosages.set(key, dosage);
      lines.push(dosage);
    }
    if (part === root) dosage.head = pairs;
    else dosage.dose = pairs;
  }
  return lines.map((line) => ("text" in line ? line : { by: line.by, text: dosageText(line) }));
}
