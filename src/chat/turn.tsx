// The two things a chat turn shows besides the answer and its cards: the one line naming what the model is doing while
// it works, with Stop beside it, and, folded after the answer, what it looked at.
import { ComposerPrimitive } from "@assistant-ui/react";
import type { UIMessage } from "ai";
import { muted, quiet } from "../look.ts";
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

/** Folded after the answer: the steps the model took to give it, each in words, a change it found in one compact line. */
export function LookedAt({
  message,
  open,
}: {
  message: UIMessage | undefined;
  open: (address: string) => void;
}) {
  const steps = stepsOf(message);
  if (steps.length === 0) return null;
  return (
    <details className="looked-at text-[0.9rem]">
      <summary className="cursor-pointer text-muted">
        What it looked at ({steps.length} {steps.length === 1 ? "step" : "steps"})
      </summary>
      <ul className="my-1 ml-4 list-disc pl-2">
        {steps.map((step, at) => (
          <StepLine key={at} step={step} open={open} />
        ))}
      </ul>
    </details>
  );
}
