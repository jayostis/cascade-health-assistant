import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CheckedReply } from "cascade-runtime";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { nodeHost } from "../node-host.ts";
import { podApi } from "../pod-api.ts";
import { loadSample, SAMPLE } from "../sample.ts";
import { recommendsInOwnVoice } from "../server/reply.ts";
import { calls, chat, chatApp, mockModel, point, post, replyOf, says, type Step, user } from "./chat-app.ts";

const POD = SAMPLE.pod;
/** Priya's HbA1c of 2026-06-15 in the compact read. */
const A1C = "Lf9c60520";
const PROCEDURES = { pod: POD, question: "pod/My procedures" };
const CITING = { says: "Her A1c", cite: { entry: A1C }, field: "value" };
/** A reply with one fact that cites the A1c; its answer is `Her A1c was 6.6 % in June.` */
const CITED = replyOf([point([CITING])]);
const RECOMMENDS = replyOf([point([CITING])], "The lab recommended a repeat A1c.");
/** A reply whose one absence says it found no mammogram in `PROCEDURES`, a query the tool call of that name backs. */
const ABSENT = replyOf([
  point(
    [],
    [
      {
        what: "a mammogram",
        match: { terms: ["mammogram"] },
        coverage: "her procedures",
        query: { tool: "ask", input: PROCEDURES },
      },
    ],
  ),
]);
const NOT_JSON = "Her A1c was high in June.";
const BREAKS_THE_CONTRACT = JSON.stringify({ answer: NOT_JSON });
const CUT_OFF = '{"answer":"Her A1c was 6.6 % in Ju';
const CUT_OFF_WHY = "the reply was cut off before it was whole";

let folder: string;
let api: ReturnType<typeof podApi>;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "reply-test-"));
  await loadSample(join(folder, POD));
  api = podApi(nodeHost({ folder }));
}, 120_000);

afterAll(async () => {
  await api?.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 5 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A question put to the chat with a model of its own that makes `steps`, one for each of its calls; its requests too. */
async function asked(steps: Step[], messages: object[] = [user("How is my A1c?")], pod: string = POD) {
  const mock = mockModel();
  mock.says(...steps);
  return { ...(await chat(chatApp(api, mock.model), messages, pod)), requests: mock.requests() };
}

/** The page's messages after an assistant turn that made the tool `calls`, each answered with `output`. */
const afterTurn = (...made: { id: string; tool: string; input: object; output: object }[]) => [
  user("Has she had a mammogram?"),
  {
    id: "a1",
    role: "assistant",
    parts: made.map(({ id, tool, input, output }) => ({
      type: `tool-${tool}`,
      toolCallId: id,
      state: "output-available",
      input,
      output,
    })),
  },
];
const ASKED_PROCEDURES = (id: string) => ({
  id,
  tool: "ask",
  input: PROCEDURES,
  output: { question: PROCEDURES.question, total: 0, rows: [] },
});

/**
 * When the model stops, the server holds its last words to the reply contract and checks each fact and absence against
 * the pod with `checkReply`. It then streams the answer's text and the checked reply as a `data-reply` part, so the page
 * shows what the pod holds and says so when nothing was checked.
 */
describe("Checking a model's reply before a person sees it · POST /chat, data-reply", () => {
  describe("when the model's reply follows the contract", () => {
    it("streams the reply's `answer` as one text part, never the JSON the model wrote", async () => {
      const { text, chunks } = await asked([says(CITED)]);
      expect(text).toBe("Her A1c was 6.6 % in June.");
      expect(chunks.filter(({ type }) => type === "text-delta")).toHaveLength(1);
    });

    it("streams the checked reply as a `data-reply` part of `type` and `data` alone, after the text and before `finish`", async () => {
      const { chunks } = await asked([says(CITED)]);
      const part = chunks.find(({ type }) => type === "data-reply")!;
      const types = chunks.map(({ type }) => type);
      expect(Object.keys(part).sort()).toEqual(["data", "type"]);
      expect(types.indexOf("text-end")).toBeLessThan(types.indexOf("data-reply"));
      expect(types.indexOf("data-reply")).toBeLessThan(types.indexOf("finish"));
    });

    it("returns a fact that cites a handle of the pod as `ok`, filled with the pod's label, value and date", async () => {
      const { checked } = await asked([says(CITED)]);
      const [fact] = checked!.items[0]!.facts;
      expect(fact!.verdict.ok).toBe(true);
      expect(fact!.filled).toMatchObject({
        label: "Hemoglobin A1c/Hemoglobin.total in Blood",
        value: "6.6 %",
        date: "2026-06-15",
      });
    });

    it("checks a reply that ended with the finish reason `other`", async () => {
      const { checked, text } = await asked([says(CITED, "other")]);
      expect(text).toBe("Her A1c was 6.6 % in June.");
      expect(checked!.items[0]!.facts[0]!.verdict.ok).toBe(true);
    });
  });

  describe("given an absence", () => {
    it("returns it backed when this request ran the tool call it names", async () => {
      const { checked } = await asked([calls("ask", PROCEDURES), says(ABSENT)], [user("Has she had a mammogram?")]);
      expect(checked!.items[0]!.absences[0]!.backing).toEqual({ backed: true });
    });

    it("returns `query not run` when only the page's messages hold the tool's output", async () => {
      const { checked } = await asked([says(ABSENT)], afterTurn(ASKED_PROCEDURES("call-0")));
      expect(checked!.items[0]!.absences[0]!.backing).toMatchObject({ backed: false, reason: "query not run" });
    });

    it("returns `query not run` for a tool call an earlier request ran", async () => {
      // The earlier request ended in a page tool, `open_pod`; this one carries its two calls, answered.
      const { checked } = await asked(
        [says(ABSENT)],
        afterTurn(ASKED_PROCEDURES("call-ask"), {
          id: "call-open",
          tool: "open_pod",
          input: { pod: POD },
          output: { opened: POD },
        }),
      );
      expect(checked!.items[0]!.absences[0]!.backing).toMatchObject({ backed: false, reason: "query not run" });
    });
  });

  describe("when the model's turn ends in a call to a page tool", () => {
    it("sends no `data-reply` part", async () => {
      const { checked } = await asked(
        [calls("ask", PROCEDURES, "call-ask"), calls("open_pod", { pod: POD }, "call-open")],
        [user("Has she had a mammogram?")],
      );
      expect(checked).toBeUndefined();
    });
  });

  describe("with no pod open", () => {
    it("checks the reply against the one pod the model's tool calls read", async () => {
      const { checked } = await asked([calls("ask", PROCEDURES), says(CITED)], [user("How is my A1c?")], "");
      expect(checked!.items[0]!.facts[0]!.verdict.ok).toBe(true);
    });

    it("returns one error and no checked items, with the answer, when the model read no pod", async () => {
      const { checked, text } = await asked([says(CITED)], [user("How is my A1c?")], "");
      expect(checked).toMatchObject({ items: [] });
      expect(checked!.errors).toHaveLength(1);
      expect(text).toBe("Her A1c was 6.6 % in June.");
    });
  });

  describe("given a pod that cannot be read", () => {
    it("returns one error and no checked items, with the answer", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(api, "ask").mockRejectedValue(new Error("the pod is locked"));
      const { checked, text } = await asked([says(CITED)]);
      expect(text).toBe("Her A1c was 6.6 % in June.");
      expect(checked!.errors).toHaveLength(1);
      expect(checked!.items).toEqual([]);
    });
  });

  describe("given a reply that is not the contract's", () => {
    it("shows a reply that is not JSON as the model wrote it", async () => {
      expect((await asked([says(NOT_JSON)])).text).toBe(NOT_JSON);
    });

    it("shows the `answer` of JSON that breaks the contract", async () => {
      expect((await asked([says(BREAKS_THE_CONTRACT)])).text).toBe(NOT_JSON);
    });

    it("returns the reasons in `errors`, with no `reply` and no checked items", async () => {
      for (const said of [NOT_JSON, BREAKS_THE_CONTRACT]) {
        const { checked } = await asked([says(said)]);
        expect(checked!.errors.length, said).toBeGreaterThan(0);
        expect(checked!.reply, said).toBeUndefined();
        expect(checked!.items, said).toEqual([]);
      }
    });

    it("shows `The model gave no reply.` for a model that says nothing", async () => {
      expect((await asked([says("  ")])).text).toBe("The model gave no reply.");
    });
  });

  describe("given a reply cut off at the length limit", () => {
    it("shows the answer as far as it was written, never raw JSON", async () => {
      for (const said of [CUT_OFF, `\`\`\`json\n${CUT_OFF}`])
        expect((await asked([says(said, "length")])).text, said).toBe("Her A1c was 6.6 % in Ju");
    });

    it("shows `The answer was cut off.` when the answer had not begun", async () => {
      expect((await asked([says('{"ans', "length")])).text).toBe("The answer was cut off.");
    });

    it("returns in `errors` that the reply was cut off before it was whole", async () => {
      for (const said of [CUT_OFF, '{"ans', `\`\`\`json\n${CUT_OFF}`])
        expect((await asked([says(said, "length")])).checked!.errors, said).toEqual([CUT_OFF_WHY]);
    });
  });
});

/**
 * A reply that was not checked for a fault of the model's (not JSON, not the contract's, or saying recommend in its own
 * voice) is asked for once more, with the reason, before the person sees anything. The second reply is shown only if it
 * is checked; otherwise the first is, marked as not checked.
 */
describe("Asking a model once more for a reply that was not checked · POST /chat, data-checking", () => {
  describe("when the first reply is not checked for a fault of the model's", () => {
    it.each([
      ["is not JSON", NOT_JSON],
      ["breaks the contract", BREAKS_THE_CONTRACT],
      ["says recommend in its own voice", RECOMMENDS],
    ])("shows the second reply, checked, in place of one that %s", async (_, first) => {
      const { checked, text } = await asked([calls("ask", PROCEDURES), says(first), says(CITED)]);
      expect(checked!.errors).toEqual([]);
      expect(checked!.items[0]!.facts[0]!.verdict.ok).toBe(true);
      expect(text).toBe("Her A1c was 6.6 % in June.");
    });

    it("asks again over the same messages, the tool call and the first reply, then a `user` message that says `Reply again`", async () => {
      const { requests } = await asked([calls("ask", PROCEDURES), says(NOT_JSON), says(CITED)]);
      expect(requests).toHaveLength(3);
      const prompt = requests[2]!.prompt;
      expect(prompt.map(({ role }) => role)).toEqual(["system", "user", "assistant", "tool", "assistant", "user"]);
      expect(JSON.stringify(prompt.at(-1)!.content)).toContain("Reply again");
    });

    it("bounds the second reply at 16,000 output tokens, and the first at none", async () => {
      const { requests } = await asked([calls("ask", PROCEDURES), says(NOT_JSON), calls("ask", PROCEDURES)]);
      expect(requests.map(({ maxOutputTokens }) => maxOutputTokens)).toEqual([undefined, undefined, 16000]);
    });

    it("runs no tool that the model calls in place of the second reply", async () => {
      const ask = vi.spyOn(api, "ask");
      const { checked, text } = await asked([calls("ask", PROCEDURES), says(NOT_JSON), calls("ask", PROCEDURES)]);
      expect(ask).toHaveBeenCalledTimes(1);
      expect(text).toBe(NOT_JSON);
      expect(checked!.errors.length).toBeGreaterThan(0);
    });
  });

  describe("when the second reply is not checked either", () => {
    it("shows the first reply's text, with its errors", async () => {
      const { checked, text } = await asked([says(RECOMMENDS), says("Something else.")]);
      expect(text).toBe("The lab recommended a repeat A1c.");
      expect(checked!.errors.length).toBeGreaterThan(0);
    });

    it("calls the model twice and no more", async () => {
      for (const said of [NOT_JSON, BREAKS_THE_CONTRACT])
        expect((await asked([says(said)])).requests, said).toHaveLength(2);
    });

    it("shows the first reply when the model fails on the second call, with no `error` part", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const mock = mockModel(async (call) => {
        if (call === 1) return says(RECOMMENDS);
        throw new Error("the model is gone");
      });
      const { chunks, text } = await chat(chatApp(api, mock.model), [user("How is my A1c?")], POD);
      expect(text).toBe("The lab recommended a repeat A1c.");
      expect(chunks.some(({ type }) => type === "error")).toBe(false);
    });

    it("shows the complete first reply when the second is cut off", async () => {
      const { checked, requests, text } = await asked([says(RECOMMENDS), says(CUT_OFF, "length")]);
      expect(requests).toHaveLength(2);
      expect(text).toBe("The lab recommended a repeat A1c.");
      expect(checked!.errors.length).toBeGreaterThan(0);
    });
  });

  describe("when asking again cannot help", () => {
    it("asks only once for a reply cut off at the length limit", async () => {
      expect((await asked([says(CUT_OFF, "length")])).requests).toHaveLength(1);
    });

    it("sends no `data-checking` part for a reply cut off at the length limit", async () => {
      const { chunks } = await asked([says(CUT_OFF, "length")]);
      expect(chunks.some(({ type }) => type === "data-checking")).toBe(false);
    });

    it("asks only once with no pod open and none read", async () => {
      expect((await asked([says(CITED)], [user("How is my A1c?")], "")).requests).toHaveLength(1);
    });

    it("asks only once when the pod could not be read", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(api, "ask").mockRejectedValue(new Error("the pod is locked"));
      const { checked, requests } = await asked([says(CITED)]);
      expect(checked!.errors, "the setup leaves the reply unchecked").toHaveLength(1);
      expect(requests).toHaveLength(1);
    });
  });

  describe("when the page is told the answer is being checked", () => {
    let toldBefore: boolean | undefined;
    let stream: { type: string; transient?: boolean }[];

    beforeAll(async () => {
      let told = false;
      const mock = mockModel(async (call) => {
        if (call === 1) return says(NOT_JSON);
        // The second request waits until the reader has seen the part, to learn whether it was sent first.
        for (let waited = 0; !told && waited < 200; waited++) await new Promise((resolve) => setTimeout(resolve, 10));
        toldBefore = told;
        return says(CITED);
      });
      const response = await post(chatApp(api, mock.model), POD, [user("How is my A1c?")]);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let all = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const read = decoder.decode(value, { stream: true });
        all += read;
        if (read.includes('"data-checking"')) told = true;
      }
      stream = all
        .split("\n\n")
        .filter((event) => event.startsWith("data: {"))
        .map((event) => JSON.parse(event.slice("data: ".length)));
    }, 30_000);

    it("sends one transient `data-checking` part before the model is asked again", () => {
      expect(toldBefore).toBe(true);
      const checking = stream.filter(({ type }) => type === "data-checking");
      expect(checking).toHaveLength(1);
      expect(checking[0]!.transient).toBe(true);
    });

    it("sends it before the answer's text", () => {
      expect(stream.findIndex(({ type }) => type === "data-checking")).toBeLessThan(
        stream.findIndex(({ type }) => type === "text-delta"),
      );
    });
  });
});

const QUOTE = "Recommend follow-up CT";

/** A checked reply whose one fact passed its check with `QUOTE`, and the model's texts as `set`. */
function checkedWith(set: {
  quote?: string;
  answer?: string;
  factSays?: string;
  coverage?: string;
  guideline?: string;
  itemLink?: string;
  link?: string;
}): CheckedReply {
  const fact = {
    says: set.factSays ?? "Her A1c",
    cite: { entry: A1C },
    field: "text" as const,
    quote: set.quote ?? QUOTE,
  };
  const reply = {
    answer: set.answer ?? "Her A1c was 6.6 % in June.",
    short: "A1c 6.6 %.",
    items: [
      {
        n: 1,
        says: "Her A1c was high in June.",
        why: "It is above the lab's range.",
        confidence: "high",
        facts: [fact],
        absences: [
          {
            what: "a mammogram",
            match: { terms: ["mammogram"] },
            coverage: set.coverage ?? "her procedures",
            query: { tool: "ask", input: {} },
          },
        ],
        ...(set.guideline === undefined
          ? {}
          : { knowledge: { says: "Screening is yearly.", guideline: set.guideline } }),
        ...(set.itemLink === undefined ? {} : { links: [{ from: 1, to: 1, says: set.itemLink }] }),
      },
    ],
    ...(set.link === undefined
      ? {}
      : { links: [{ from: { item: 1, fact: 1 }, to: { item: 1, fact: 1 }, says: set.link }] }),
  };
  return {
    errors: [],
    reply,
    items: [{ facts: [{ fact, verdict: { ok: true } }], absences: [] }],
  } as unknown as CheckedReply;
}

/**
 * The model may tell a person what a record recommends only in the record's words: inside quotation marks, as a quote the
 * check found in the record. A reply that says "recommend" anywhere else speaks in its own voice, and the server shows it
 * as not checked.
 */
describe("Keeping a recommendation in a record's own words · recommendsInOwnVoice(), POST /chat", () => {
  describe("recommendsInOwnVoice(checked)", () => {
    it("returns false for a passed quote inside straight quotation marks, whatever its case and spacing", () => {
      const checked = checkedWith({ answer: 'I\'d ask about it: the report says "recommend  FOLLOW-UP ct"' });
      expect(recommendsInOwnVoice(checked)).toBe(false);
    });

    it("returns false for a passed quote inside curly quotation marks", () => {
      const checked = checkedWith({ answer: "I'd ask about it: the report says “Recommend follow-up CT”" });
      expect(recommendsInOwnVoice(checked)).toBe(false);
    });

    it("returns true for a passed quote's words said outside quotation marks", () => {
      const checked = checkedWith({ quote: "recommend rest daily", answer: "I recommend rest daily" });
      expect(recommendsInOwnVoice(checked)).toBe(true);
    });

    it("returns true for the word outside the marks, after a quote inside them", () => {
      const checked = checkedWith({ answer: 'The report says "Recommend follow-up CT" and I recommend it' });
      expect(recommendsInOwnVoice(checked)).toBe(true);
    });

    it.each([
      ["a fact's `says`", { factSays: "The report recommends a CT" }],
      ["an absence's `coverage`", { coverage: "where one would recommend it" }],
      ["a knowledge `guideline`", { guideline: "Guidelines recommend yearly screening" }],
      ["a link within an item", { itemLink: "this recommends that" }],
      ["a link between items", { link: "this recommends that" }],
    ])("returns true for the word in %s", (_, set) => {
      expect(recommendsInOwnVoice(checkedWith(set))).toBe(true);
    });
  });

  describe("when a reply says recommend in its own voice", () => {
    it("shows the answer with an error and no `reply`", async () => {
      const answer = "I recommend you see Dr. Marsh sooner.";
      const { checked, text } = await asked([says(replyOf([point([CITING])], answer))]);
      expect(checked!.errors.length).toBeGreaterThan(0);
      expect(checked!.reply).toBeUndefined();
      expect(text).toBe(answer);
    });

    it("returns an error when the quote that holds the word failed its check", async () => {
      // Words the A1c result does not hold: the quote fails, and a failed quote does not excuse the word.
      const words = "we recommend a sooner visit now";
      const reply = replyOf([point([{ ...CITING, field: "text", quote: words }])], `The report says ${words}`);
      expect((await asked([says(reply)])).checked!.errors.length).toBeGreaterThan(0);
    });
  });
});
