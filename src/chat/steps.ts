// What a chat turn says of its own steps, in the app's words written from the tool's name and what it was given or
// gave back, never the model's: the line shown while the model works, and the steps folded under its answer.
import { getToolName, isToolUIPart, type UIMessage } from "ai";

/** A tool call of a message: what it was called with, how far it got, and what it gave back. */
export interface Step {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly output: unknown;
  readonly state: "working" | "done" | "failed";
}

/** A finding of `find_changes`, as the page gets it: the model's compact finding with its rows and the app's sentence. */
export interface Found {
  readonly key: string;
  readonly said?: string;
  readonly direction?: string;
  readonly unit: string;
  readonly test: {
    readonly code: string;
    readonly notation?: string;
    readonly name?: string;
  };
  readonly medication: { readonly name: string };
  readonly before: Side;
  readonly after: Side;
  readonly rows: readonly {
    readonly entry: string;
    readonly performed: string;
    readonly value: string;
    readonly unit: string;
    readonly side: string;
  }[];
}

export interface Side {
  readonly count: number;
  readonly mean: number;
  readonly min: number;
  readonly max: number;
}

/** The calls of `message` to tools, in the order made. */
export function stepsOf(message: UIMessage | undefined): Step[] {
  return (message?.parts ?? []).flatMap((part) => {
    if (!isToolUIPart(part)) return [];
    const input = part.input;
    return [
      {
        name: getToolName(part),
        input:
          typeof input === "object" && input !== null
            ? (input as Record<string, unknown>)
            : {},
        output: "output" in part ? part.output : undefined,
        state:
          part.state === "output-available"
            ? "done"
            : part.state === "output-error" || part.state === "output-denied"
              ? "failed"
              : "working",
      },
    ];
  });
}

/** An input that is a person's or a thing's name, not a code: LOINC and RxNorm codes, and IRIs, say nothing read alone. */
function named(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text === "" || /^[\d-]+$/.test(text) || /^[a-z]+:\/\//i.test(text)
    ? undefined
    : text.slice(0, 80);
}

/** The one medication every finding of `output` is about, where they all are. */
function medicationOf(output: unknown): string | undefined {
  if (!Array.isArray(output)) return undefined;
  const names = new Set(
    (output as Found[]).map((found) => found?.medication?.name),
  );
  const [only] = names;
  return names.size === 1 && typeof only === "string" ? only : undefined;
}

/** A question's name as the person reads it: `pod/My active medications` is "active medications". */
const questionSaid = (question: unknown) => {
  const text = named(question);
  if (text === undefined) return "the pod's records";
  const plain = text.replace(/^[a-z]+\//, "").replace(/^My /, "");
  return plain.charAt(0).toLowerCase() + plain.slice(1);
};

/** Each tool's words: the verb as it is happening, as it happened, and what it was about. */
const WORDS: Record<
  string,
  readonly [doing: string, did: string, about: (step: Step) => string]
> = {
  list_pods: ["Checking", "Checked", () => "which pods there are"],
  find_changes: [
    "Looking at",
    "Looked at",
    ({ input, output }) =>
      `lab results after ${named(input.medication) ?? medicationOf(output) ?? "medications"}`,
  ],
  finding_rows: ["Reading", "Read", () => "the results behind a finding"],
  lab_series: [
    "Reading",
    "Read",
    ({ input }) => `${named(input.test) ?? "one test"}'s results over time`,
  ],
  timeline: [
    "Reading",
    "Read",
    () => "the medications and the day each started",
  ],
  ask: ["Reading", "Read", ({ input }) => questionSaid(input.question)],
  reference_table_checks: [
    "Checking",
    "Checked",
    () => "the records against the reference tables",
  ],
  worth_a_look: ["Reading", "Read", () => "the pod's Worth a look list"],
  open_pod: ["Opening", "Opened", () => "the pod's page"],
  open_trend: ["Opening", "Opened", () => "a trend of results over time"],
  open_entry: ["Opening", "Opened", () => "an entry"],
  open_classes: ["Opening", "Opened", () => "the medications by class"],
  open_panel: ["Opening", "Opened", () => "a panel of results"],
  open_table: ["Opening", "Opened", () => "a reference table"],
  make_pod: [
    "Making",
    "Made",
    ({ input }) => `a pod for ${named(input.person) ?? "a person"}`,
  ],
  check_tables: [
    "Checking",
    "Checked",
    () => "the reference tables for newer versions",
  ],
  set_world_date: [
    "Setting",
    "Set",
    () => "the date the demo hospitals answer as of",
  ],
};

/** One step in words: as it is happening while it works, as it happened once it is over. */
export function stepSaid(step: Step): string {
  const [doing, did, about] = WORDS[step.name] ?? [
    "Using",
    "Used",
    () => step.name.replaceAll("_", " "),
  ];
  const text = `${step.state === "working" ? doing : did} ${about(step)}`;
  return step.state === "failed" ? `${text}, which gave nothing` : text;
}

/** What the model is doing now: the step still running, else that it has what it asked for and is writing the answer. */
export function workingSaid(messages: readonly UIMessage[]): string {
  const last = messages.at(-1);
  const steps = last?.role === "assistant" ? stepsOf(last) : [];
  const running = steps.find(({ state }) => state === "working");
  if (running !== undefined) return stepSaid(running);
  return steps.length === 0
    ? "Reading the question"
    : "Putting the answer together";
}

/** The findings `find_changes` gave in a step, none if it gave an error or something else. */
export function foundIn({ name, output, state }: Step): readonly Found[] {
  return name === "find_changes" && state === "done" && Array.isArray(output)
    ? (output as Found[])
    : [];
}

/** That a finding says only that its two sides had not enough results to be set against each other. */
export const isThin = ({ direction, said }: Found) =>
  direction === "not enough results" || said === undefined;

/** How many decimals a result's value is written with: "0.88" has two. */
const decimalsOf = (value: string) => /\.(\d+)/.exec(value)?.[1]?.length ?? 0;

/**
 * A side as the app says it: the min and max are the results' own values, and the mean keeps at least their decimals
 * (and one), so that 0.88 and 1.02 give "mean 0.95 ... (0.88 to 1.02)". `values` are the side's results as written.
 */
export function sideSaid(
  name: string,
  side: Side,
  unit: string,
  values: readonly string[],
) {
  if (side.count === 0) return `${name}: no results`;
  const decimals = Math.max(1, ...values.map(decimalsOf));
  const mean = Number(side.mean.toFixed(decimals));
  return `${name}: mean ${mean} ${unit} over ${side.count} ${side.count === 1 ? "result" : "results"} (${side.min} to ${side.max})`;
}

/** A finding's two sides, each said with its own results' values. */
export const sidesSaid = (found: Found) =>
  (["before", "after"] as const).map((side) =>
    sideSaid(
      side === "before" ? "Before" : "After",
      found[side],
      found.unit,
      found.rows.filter((row) => row.side === side).map((row) => row.value),
    ),
  );
