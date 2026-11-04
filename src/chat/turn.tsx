// The two things a chat turn shows besides the answer: the one line naming what the model is doing while it works, with
// Stop beside it, and, after the answer, the one folded line over the cards and what it looked at.
import { ComposerPrimitive } from "@assistant-ui/react";
import type { UIMessage } from "ai";
import type { CheckedReply } from "cascade-runtime";
import { muted, quiet } from "../look.ts";
import { pointsOf, ReplyCards, verdictOf } from "./reply.tsx";
import {
  foundIn,
  isThin,
  sidesSaid,
  stepSaid,
  stepsOf,
  workingSaid,
  type Found,
  type Step,
} from "./steps.ts";

/** Under the question while the model works: what it is doing now, and Stop. */
export function Working({
  messages,
  stoppable,
  checking = false,
}: {
  messages: readonly UIMessage[];
  stoppable: boolean;
  checking?: boolean;
}) {
  return (
    <div
      className="working flex items-baseline gap-3 text-[0.9rem] text-muted"
      role="status"
    >
      <span>{workingSaid(messages, checking)}…</span>
      {stoppable && (
        <ComposerPrimitive.Cancel
          className={`${quiet} chat-stop px-[0.7rem] py-[0.1rem]`}
        >
          Stop
        </ComposerPrimitive.Cancel>
      )}
    </div>
  );
}

/** A finding that has a direction, as one line of what was looked at: the app's sentence and the two sides' numbers. */
function Compact({
  found,
  open,
}: {
  found: Found;
  open: (address: string) => void;
}) {
  const [before, after] = sidesSaid(found);
  const { view } = found;
  return (
    <li className="finding">
      <span className="said">{found.said}</span>
      <span className={`${muted} block`}>
        {before}. {after}.
      </span>
      {view !== undefined && (
        <button type="button" className={quiet} onClick={() => open(view)}>
          Open the trend
        </button>
      )}
    </li>
  );
}

/** The findings of a `find_changes` step: those with a direction one line each, the rest together in one quiet line. */
function Findings({
  found,
  open,
}: {
  found: readonly Found[];
  open: (address: string) => void;
}) {
  const thin = found.filter(isThin);
  const medications = [...new Set(thin.map((each) => each.medication.name))];
  const named = [
    ...new Set(
      thin.flatMap((each) => each.test.name ?? each.test.notation ?? []),
    ),
  ];
  const unnamed = thin.some((each) => !(each.test.name ?? each.test.notation));
  const tests = unnamed ? [...named, "a test"] : named;
  return (
    <ul className="my-1 ml-4 list-disc pl-2">
      {found
        .filter((each) => !isThin(each))
        .map((each) => (
          <Compact key={each.key} found={each} open={open} />
        ))}
      {thin.length > 0 && (
        <li className={`thin ${muted}`}>
          Not enough results to compare: {tests.join(", ")}
          {medications.length === 1 ? ` around ${medications[0]}` : ""}
        </li>
      )}
    </ul>
  );
}

function StepLine({
  step,
  open,
}: {
  step: Step;
  open: (address: string) => void;
}) {
  const found = foundIn(step);
  return (
    <li className="step">
      {stepSaid(step)}
      {found.length > 0 && <Findings found={found} open={open} />}
    </li>
  );
}

/** The steps the model took to give the answer, each in words, a change it found in one compact line. */
export function LookedAt({
  message,
  open,
  titled = false,
}: {
  message: UIMessage | undefined;
  open: (address: string) => void;
  titled?: boolean;
}) {
  const steps = stepsOf(message);
  if (steps.length === 0) return null;
  return (
    <div className="looked-at text-[0.9rem]">
      {titled && <div className={muted}>What it looked at</div>}
      <ul className="my-1 ml-4 list-disc pl-2">
        {steps.map((step, at) => (
          <StepLine key={at} step={step} open={open} />
        ))}
      </ul>
    </div>
  );
}

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

const VERDICT = {
  confirmed: "text-muted",
  unconfirmed: "unconfirmed text-warm",
  "not-checked": "not-checked text-warm",
} as const;

/**
 * Under the answer, one line that carries the check's verdict and the steps' count, folded over what supports the
 * answer: the reply's cards, then what it looked at. A reply that was not checked says so on the line, folded or not.
 * A turn with nothing to open is only the line.
 */
export function Supporting({
  message,
  checked,
  pod,
  open,
}: {
  message: UIMessage | undefined;
  checked: CheckedReply | undefined;
  pod: string;
  open: (address: string) => void;
}) {
  const steps = stepsOf(message).length;
  const cards = checked !== undefined && pointsOf(checked).length > 0;
  if (checked === undefined) {
    if (steps === 0) return null;
    return (
      <details className="supporting text-[0.9rem]">
        <summary className="cursor-pointer text-muted">
          What it looked at ({count(steps, "step", "steps")})
        </summary>
        <LookedAt message={message} open={open} />
      </details>
    );
  }
  const { said, kind } = verdictOf(checked);
  const line = [said, steps === 0 ? undefined : count(steps, "step", "steps")]
    .filter((part) => part !== undefined)
    .join(" · ");
  if (!cards && steps === 0)
    return (
      <div className={`${VERDICT[kind]} text-[0.9rem]`}>{line}</div>
    );
  return (
    <details className="supporting flex flex-col gap-2 text-[0.9rem]">
      <summary className={`${VERDICT[kind]} cursor-pointer`}>{line}</summary>
      <div className="mt-2 flex flex-col gap-2">
        <ReplyCards checked={checked} pod={pod} />
        <LookedAt message={message} open={open} titled />
      </div>
    </details>
  );
}

/** The reply a turn carries: the server's `data-reply` part, the reply as it checked it. */
export const replyOf = (message: UIMessage | undefined) =>
  (
    message?.parts.find(({ type }) => type === "data-reply") as
      | { data: CheckedReply }
      | undefined
  )?.data;
