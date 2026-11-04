// What `/chat` asks of the model and does with its answer: the reply contract of `cascade-runtime` (a reply points at
// entries, and the program shows what the pod holds of each), and the runtime's checker run over the reply before the
// page sees it. A reply that is not the contract's is text the page shows as not checked, never trusted.
import {
  type CheckedReply,
  checkReply,
  type PodAsker,
  podReplyParts,
  type Ran,
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
const UNCHECKABLE = "the pod could not be read to check the reply";

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
    return unchecked(text, NOT_JSON);
  }
  const answer = (value as { answer?: unknown } | null)?.answer;
  const said = typeof answer === "string" ? answer : text;
  if (ask === undefined) return unchecked(said, NO_POD);
  try {
    const checked = await checkReply(value, { ask, ran });
    return { answer: checked.reply?.answer ?? said, checked };
  } catch (error) {
    console.error(error);
    return unchecked(said, UNCHECKABLE);
  }
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

/** `rows`, a pod's answer to a question, as the checker asks it: each question is read once. */
export function asker(
  rows: (question: string) => Promise<readonly Readonly<Record<string, string>>[]>,
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
