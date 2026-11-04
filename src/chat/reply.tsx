// A checked reply as the chat draws it: each point of the model's a card, in the order the model ranked them; each fact
// a chip, confirmed or not, showing what the pod holds (never the model's words for it) and opening the entry, whose
// page says where it came from; each absence with what was searched; the model's own knowledge labelled as such.
import type { CheckedReply } from "cascade-runtime/reply";
import { useState } from "react";
import { day } from "../../said.ts";
import { useAddress } from "../address.tsx";
import { muted, quiet } from "../look.ts";

/** How many points show before "Show items": a person reads the first few, and the rest are one click away. */
export const SHOWN = 4;

type Item = CheckedReply["items"][number];
type Fact = Item["facts"][number];
type Absence = Item["absences"][number];
type Said = NonNullable<CheckedReply["reply"]>["items"][number];

/** How a date reads beside what the entry is: an end date is not the day it happened. */
const DATE_WORDS = {
  when: "",
  start: "started ",
  end: "ended ",
  recorded: "recorded ",
} as const;

/** A source as the person knows it: `S8 Kestrel Harbor Hospital` is the hospital, S8 being the model's own legend. */
const placeOf = (source: string) => source.replace(/^S\d+ /, "");

const sourcesOf = (sources: readonly string[]) => [
  ...new Set(sources.map(placeOf)),
];

/**
 * Why a fact could not be confirmed, in the checker's words: `no such field: end`. What it missed of a record that is
 * not there is the model's handle, which says nothing to a person.
 */
const whyNot = ({ verdict, filled }: Fact) =>
  verdict.ok
    ? ""
    : [verdict.reason, ...(filled === undefined ? [] : verdict.missing)].join(
        ": ",
      );

const CHIP =
  "chip inline-flex max-w-full items-baseline gap-[0.35rem] rounded-[1rem] border px-[0.65rem] py-[0.2rem] text-[0.85rem] leading-snug no-underline";
const CONFIRMED = `${CHIP} confirmed border-accent bg-tint text-text`;
const UNCONFIRMED = `${CHIP} unconfirmed border-warm bg-warm-bg text-warm`;

/** One fact: what the entry holds of it, whether the check passed, and the entry it opens when the cite resolved. */
function FactChip({ checked, pod }: { checked: Fact; pod: string }) {
  const { entry } = useAddress();
  const { filled, verdict } = checked;
  const when =
    filled?.date === undefined
      ? undefined
      : `${DATE_WORDS[filled.dateKind ?? "when"]}${day(filled.date)}`;
  const places = filled === undefined ? [] : sourcesOf(filled.sources);
  const what = [
    filled?.label,
    filled?.value,
    when,
    places.length === 0 ? undefined : `from ${places.join(", ")}`,
  ].filter((part) => part !== undefined && part !== "");
  /** Words of the entry's text, shown only once the check found them there whole. */
  const quoted = verdict.ok ? checked.fact.quote : undefined;
  const body = (
    <>
      {verdict.ok ? (
        <>
          <span aria-hidden="true">✓</span>
          <span className="sr-only">Confirmed: </span>
        </>
      ) : (
        <strong className="font-semibold">couldn't confirm</strong>
      )}
      <span>{what.length > 0 ? what.join(" · ") : "an entry"}</span>
      {quoted !== undefined && <q className="quote">{quoted}</q>}
      {!verdict.ok && (
        <span className="text-[0.8rem]">({whyNot(checked)})</span>
      )}
    </>
  );
  const className = verdict.ok ? CONFIRMED : UNCONFIRMED;
  return filled === undefined || pod === "" ? (
    <span className={className}>{body}</span>
  ) : (
    <a className={className} href={entry(pod, filled.entry)}>
      {body}
    </a>
  );
}

/** One absence: what was searched, over what, and whether the search a program re-ran found nothing, as the model said. */
function Searched({ checked: { absence, backing } }: { checked: Absence }) {
  return (
    <p
      className={`absence ${backing.backed ? "backed" : "unbacked"} m-0 ${muted}`}
    >
      {`Searched: ${absence.what}`}
      {` · ${absence.coverage} · `}
      {backing.backed ? (
        "re-run, nothing found"
      ) : (
        <strong className="font-semibold text-warm">
          {`couldn't confirm: ${backing.reason}`}
        </strong>
      )}
    </p>
  );
}

/** The model's own knowledge, which no record backs, and the source it named for it. */
function Knowledge({ says }: { says: NonNullable<Said["knowledge"]> }) {
  return (
    <div className="knowledge rounded-lg border border-dashed border-line bg-soft px-[0.7rem] py-[0.4rem] text-[0.9rem]">
      <div className="text-[0.7rem] font-bold tracking-[0.05em] text-muted uppercase">
        General information, not from your records
      </div>
      <p className="m-0">{says.says}</p>
      <p className={`m-0 ${muted}`}>
        {says.guideline === undefined
          ? "No source named."
          : `Its source: ${says.guideline}.`}
      </p>
    </div>
  );
}

/** A point: the model's sentence, why, the facts it rests on and the searches, then what the model knows besides. */
function Point({
  checked,
  said,
  pod,
}: {
  checked: Item;
  said: Said;
  pod: string;
}) {
  const facts = checked.facts ?? [];
  const absences = checked.absences ?? [];
  return (
    <article className="point flex flex-col gap-2 rounded-[10px] border border-line bg-page px-[0.9rem] py-[0.7rem] whitespace-normal">
      <header className="flex items-baseline gap-2">
        <span className="n inline-flex size-6 flex-none items-center justify-center rounded-full bg-accent text-[0.8rem] font-bold text-on-accent">
          {checked.n}
        </span>
        <strong className="leading-snug">{said.says}</strong>
      </header>
      <p className="why m-0">{said.why}</p>
      {facts.length > 0 && (
        <ul className="chips m-0 flex list-none flex-wrap gap-[0.4rem] p-0">
          {facts.map((fact, at) => (
            <li className="chip-item min-w-0" key={at}>
              <FactChip checked={fact} pod={pod} />
            </li>
          ))}
        </ul>
      )}
      {absences.map((absence, at) => (
        <Searched checked={absence} key={at} />
      ))}
      {said.knowledge !== undefined && <Knowledge says={said.knowledge} />}
    </article>
  );
}

/** The points of a checked reply, or, for one that did not fit the contract, that it was not checked. */
export function ReplyCards({
  checked,
  pod,
}: {
  checked: CheckedReply;
  pod: string;
}) {
  const [all, setAll] = useState(false);
  const { errors, reply, items } = checked;
  if (
    !Array.isArray(errors) ||
    !Array.isArray(items) ||
    errors.length > 0 ||
    reply === undefined
  )
    return (
      <div className="not-checked rounded-r-[7px] border-l-[3px] border-warm bg-warm-bg px-[0.8rem] py-[0.4rem] text-warm">
        Not checked: this reply did not follow the form the checks need, so
        nothing in it is confirmed by your records.
      </div>
    );
  const points = items.flatMap((item) => {
    const said = reply.items.find(({ n }) => n === item.n);
    return said === undefined ? [] : [{ item, said }];
  });
  const hidden = points.length - SHOWN;
  if (points.length === 0) return null;
  return (
    <div className="cards flex flex-col gap-2 whitespace-normal">
      {points.slice(0, all ? undefined : SHOWN).map(({ item, said }) => (
        <Point checked={item} said={said} pod={pod} key={item.n} />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          className={`${quiet} more self-start px-0`}
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          {all
            ? "Show fewer"
            : hidden === 1
              ? `Show item ${SHOWN + 1}`
              : `Show items ${SHOWN + 1} to ${points.length}`}
        </button>
      )}
    </div>
  );
}
