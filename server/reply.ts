// What `/chat` asks of the model and does with its answer: the reply contract of `cascade-runtime` (a reply points at
// entries, and the program shows what the pod holds of each), and the runtime's checker run over the reply before the
// page sees it. A reply that is not the contract's is text the page shows as not checked, never trusted.
import { parsePartialJson } from "ai";
import {
  type CheckedReply,
  checkReply,
  type PodAsker,
  podReplyParts,
  type Ran,
  type Reply,
  replyContract,
} from "cascade-runtime";

/**
 * The runtime's words for a reply about a pod, less the call number an absence's query carries: the eval's model is
 * printed one after each tool's answer, and the chat's is not, so a query names its tool and input alone.
 */
export const PARTS = {
  ...podReplyParts,
  absence: podReplyParts.absence.replace(
    ', "call": <the number the command printed after its answer>',
    "",
  ),
  example: podReplyParts.example.replace(', "call": 3', ""),
};

/** The contract as the model is given it. "Their" because the pod does not say how a person is addressed. */
export const CONTRACT = replyContract("their", PARTS);

const NO_REPLY = "The model gave no reply.";
const NOT_JSON = "the reply is not JSON";
const NO_POD =
  "no pod is open to check the reply against, and the model read none or several";
const CUT_OFF = "The answer was cut off.";
const CUT_OFF_WHY = "the reply was cut off before it was whole";
const RECOMMENDS = "the reply says it recommends something in its own voice";
const UNCHECKABLE = "the pod could not be read to check the reply";

const AGAIN =
  "Reply again with the same points, and nothing else, as JSON in the form your instructions give, calling no tool.";

/**
 * What the model is asked once more when its reply was not checked for a fault of its own, with why; nothing when
 * the reply was checked, or when asking again cannot help (no pod to check it against, or one that could not be read).
 */
export function askAgain({ checked }: Replied): string | undefined {
  const [why] = checked.errors;
  if (
    checked.reply !== undefined ||
    why === undefined ||
    why === NO_POD ||
    why === UNCHECKABLE
  )
    return undefined;
  if (why === RECOMMENDS)
    return `Your reply says "recommend" in your own words. A record's recommendation is given only in its words, inside double quotation marks, as a fact's quote, in every text of the reply. ${AGAIN}`;
  return `Your reply could not be checked: ${checked.errors.join("; ")}. ${AGAIN}`;
}

/** What the page is sent for a reply: the text to show, and the reply checked. */
export interface Replied {
  /** The reply's answer, or for a reply that was not checked, what the model said. */
  readonly answer: string;
  readonly checked: CheckedReply;
}

/**
 * `text`, the model's last words, held to the contract and checked against the pod `ask` reads, with the tool calls
 * `ran` that produced it. Whatever it is, the answer to show comes back; `checked.errors` says why when it was not checked.
 */
export async function repliedTo(
  text: string,
  { ask, ran }: { ask: PodAsker["ask"] | undefined; ran: readonly Ran[] },
): Promise<Replied> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    const unfenced = text
      .trim()
      .replace(/^```[a-z]*\s*/i, "")
      .replace(/\s*```$/, "");
    if (!unfenced.startsWith("{")) return unchecked(text, NOT_JSON);
    const { value: partial } = await parsePartialJson(unfenced);
    const begun = (partial as { answer?: unknown } | undefined)?.answer;
    return unchecked(
      typeof begun === "string" && begun.trim() !== "" ? begun : CUT_OFF,
      CUT_OFF_WHY,
    );
  }
  const answer = (value as { answer?: unknown } | null)?.answer;
  const said = typeof answer === "string" ? answer : text;
  if (ask === undefined) return unchecked(said, NO_POD);
  try {
    const checked = await checkReply(value, { ask, ran });
    if (checked.reply !== undefined && recommending(checked))
      return unchecked(said, RECOMMENDS);
    return { answer: checked.reply?.answer ?? said, checked };
  } catch (error) {
    console.error(error);
    return unchecked(said, UNCHECKABLE);
  }
}

/**
 * Whether a checked reply says "recommend" in its own voice: in any text the model wrote, outside the quotation marks
 * round a passed fact's quote. Source text is quoted exactly, the word included; the same words said unquoted, or a
 * quote that failed its check, do not excuse it. Case and spacing do not matter to the match.
 */
export function recommending({ reply, items }: CheckedReply): boolean {
  const quotes = items.flatMap(({ facts }) =>
    facts.flatMap(({ fact, verdict }) =>
      verdict.ok && "quote" in fact && fact.quote?.trim()
        ? [
            new RegExp(
              fact.quote
                .trim()
                .split(/\s+/)
                .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                .join("\\s+"),
              "gi",
            ),
          ]
        : [],
    ),
  );
  const outside = (text: string) =>
    text.replace(/"[^"]*"|“[^”]*”/g, (marked) =>
      quotes.reduce((rest, quote) => rest.replace(quote, ""), marked),
    );
  return textsOf(reply!).some((text) => /recommend/i.test(outside(text)));
}

/** Every text of a reply the model wrote. */
function textsOf(reply: Reply): string[] {
  return [
    reply.answer,
    reply.short,
    ...(reply.links ?? []).map(({ says }) => says),
    ...reply.items.flatMap((item) => [
      item.says,
      item.why,
      item.knowledge?.says ?? "",
      item.knowledge?.guideline ?? "",
      ...(item.facts ?? []).map(({ says }) => says),
      ...(item.absences ?? []).flatMap(({ what, coverage }) => [what, coverage]),
      ...(item.links ?? []).map(({ says }) => says),
    ]),
  ];
}

function unchecked(said: string, why: string): Replied {
  return {
    answer: said.trim() === "" ? NO_REPLY : said,
    checked: { errors: [why], items: [] },
  };
}

/** The pod the reply is about: the one the page is on, else the one every tool call of the request named. */
export function podOf(open: string, ran: readonly Ran[]): string | undefined {
  if (open !== "") return open;
  const named = new Set(
    ran.flatMap(({ input }) =>
      typeof input.pod === "string" && input.pod !== "" ? [input.pod] : [],
    ),
  );
  return named.size === 1 ? [...named][0] : undefined;
}

/**
 * `rows`, a pod's answer to a question, as the checker asks it: each question is read once, so that a pod that cannot be
 * read rejects one promise every part of the check awaits (the checker asks the same question from two places, and
 * would leave a second promise's rejection unhandled, which ends the process).
 */
export function asker(
  rows: (
    question: string,
  ) => Promise<readonly Readonly<Record<string, string>>[]>,
): PodAsker["ask"] {
  const read = new Map<string, ReturnType<typeof rows>>();
  return (question) => {
    let each = read.get(question);
    if (each === undefined) {
      each = rows(question);
      read.set(question, each);
    }
    return each;
  };
}
