// A checked reply as the chat draws it: each point of the model's a card, in the order the model ranked them; each fact
// a chip, confirmed or not, showing what the pod holds (never the model's words for it) and opening the entry, whose
// page says where it came from; each absence with what was searched; the model's own knowledge labelled as such.
import type { CheckedReply } from "cascade-runtime";
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
 * not there is the model's handle, which says nothing to a person; a `quote …` it missed is the model's own words, and
 * the screen shows none of those as the record.
 */
const whyNot = ({ verdict, filled }: Fact) =>
  verdict.ok
    ? ""
    : [
        verdict.reason,
        ...(filled === undefined
          ? []
          : verdict.missing.filter(
              (part) => part !== "quote" && !part.startsWith("quote "),
            )),
      ].join(": ");

/** What a program re-ran for an absence, as a person reads it: the codes and words looked for, and from which day. */
const searchedFor = ({ match, query }: Absence["absence"]) =>
  [
    match.codes === undefined || match.codes.length === 0
      ? undefined
      : `${match.codes.length === 1 ? "code" : "codes"} ${match.codes.join(", ")}`,
    match.terms === undefined || match.terms.length === 0
      ? undefined
      : `${match.terms.length === 1 ? "word" : "words"} ${match.terms.join(", ")}`,
    match.after === undefined ? undefined : `after ${day(match.after)}`,
    query === undefined
      ? undefined
      : `${query.tool}${query.call === undefined ? "" : ` call ${query.call}`}`,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");

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

/** One absence: what the program searched for, drawn from the match it re-ran, and whether that found nothing, as the model said. */
function Searched({ checked: { absence, backing } }: { checked: Absence }) {
  return (
    <p
      className={`absence ${backing.backed ? "backed" : "unbacked"} m-0 ${muted}`}
    >
      {`Searched: ${searchedFor(absence)} · `}
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

/** Whether the reply followed the contract and was checked: a part that is not a checked reply at all is not. */
const wasChecked = (checked: CheckedReply) =>
  Array.isArray(checked.errors) &&
  Array.isArray(checked.items) &&
  checked.errors.length === 0 &&
  checked.reply !== undefined;

/** The points of a checked reply that have both the model's words and the check; none for one that was not checked. */
export function pointsOf(checked: CheckedReply) {
  const { reply, items } = checked;
  if (!wasChecked(checked) || reply === undefined) return [];
  return items.flatMap((item) => {
    const said = reply.items.find(({ n }) => n === item.n);
    return said === undefined ? [] : [{ item, said }];
  });
}

/**
 * What the check found, in the checker's own counts and words and never the model's: that the reply was not checked and
 * why, or that it was, with how many facts and searches held and how many could not be confirmed, counted over the points the cards show.
 */
export function verdictOf(checked: CheckedReply): {
  said: string;
  kind: "confirmed" | "unconfirmed" | "not-checked";
} {
  if (!wasChecked(checked)) {
    const [why, ...more] = Array.isArray(checked.errors) ? checked.errors : [];
    return {
      said: `Not checked: ${typeof why === "string" ? why : "this reply did not follow the form the checks need"}${more.length === 0 ? "" : ` (and ${more.length} more)`}`,
      kind: "not-checked",
    };
  }
  const points = pointsOf(checked);
  const facts = points.flatMap(({ item }) => item.facts ?? []);
  const absences = points.flatMap(({ item }) => item.absences ?? []);
  const confirmed =
    facts.filter(({ verdict }) => verdict.ok).length +
    absences.filter(({ backing }) => backing.backed).length;
  const unconfirmed = facts.length + absences.length - confirmed;
  const general = points.filter(({ said }) => said.knowledge !== undefined).length;
  const lead =
    confirmed + unconfirmed === 0
      ? "Nothing in this reply was checked against your records"
      : unconfirmed > 0
        ? `${unconfirmed} of ${confirmed + unconfirmed} could not be confirmed against your records · ${confirmed} confirmed`
        : `Checked against your records · ${confirmed} confirmed`;
  return {
    said: [
      lead,
      general === 0 ? undefined : `${general} general, not from your records`,
    ]
      .filter((part) => part !== undefined)
      .join(" · "),
    kind: confirmed + unconfirmed > 0 && unconfirmed === 0 ? "confirmed" : "unconfirmed",
  };
}

/** The points of a checked reply, each a card; nothing for a reply that was not checked, which the folded line says. */
export function ReplyCards({
  checked,
  pod,
}: {
  checked: CheckedReply;
  pod: string;
}) {
  const [all, setAll] = useState(false);
  const points = pointsOf(checked);
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
