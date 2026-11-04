import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import type { CheckedReply } from "cascade-runtime";
import { replySchema } from "cascade-runtime";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { type Model, modelOf } from "../models.ts";
import { nodeHost } from "../node-host.ts";
import { podApi } from "../pod-api.ts";
import { loadSample, SAMPLE } from "../sample.ts";
import { appServer } from "../server/app.ts";
import { chatRoutes } from "../server/chat.ts";
import { asker, recommending, repliedTo } from "../server/reply.ts";

const ORIGIN = "http://app.test";
const POD = SAMPLE.pod;
/** Priya's HbA1c of 2026-06-15 in the compact read, and a handle that names nothing. */
const A1C = "Lf9c60520";
const NOTHING = "Lffffffff";
let folder: string;
let api: ReturnType<typeof podApi>;
let app: ReturnType<typeof appServer>;
let mock: MockLanguageModelV4;

const finish = (unified: "stop" | "tool-calls" | "length" | "other") =>
  ({
    type: "finish",
    finishReason: { unified, raw: undefined },
    usage: {
      inputTokens: {
        total: 1,
        noCache: 1,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    },
  }) satisfies LanguageModelV4StreamPart;

const streamOf = (parts: LanguageModelV4StreamPart[]) => ({
  parts,
  stream: new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      for (const part of [
        { type: "stream-start", warnings: [] },
        ...parts,
      ] as LanguageModelV4StreamPart[])
        controller.enqueue(part);
      controller.close();
    },
  }),
});

/** A step of the model that says `text`: what the reply is, as JSON text, and stops as `unified`. */
const says = (text: string, unified: "stop" | "length" | "other" = "stop") =>
  streamOf([
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" },
    finish(unified),
  ]);

/** A step of the model that calls `tool` with `input`. */
const calls = (tool: string, input: object) =>
  streamOf([
    {
      type: "tool-call",
      toolCallId: "call-1",
      toolName: tool,
      input: JSON.stringify(input),
    },
    finish("tool-calls"),
  ]);

/** The model of the next request: each of its calls is the next of `steps`, and any after them the last again. */
function modelSays(...steps: ReturnType<typeof streamOf>[]) {
  mock = new MockLanguageModelV4({
    doStream: async () => {
      const at = mock.doStreamCalls.length - 1;
      return at < steps.length ? steps[at]! : streamOf(steps.at(-1)!.parts);
    },
  });
}

const model: Model = {
  provider: "mock",
  name: "mock-1",
  local: true,
  language: () => mock,
  failure: () => undefined,
};

const point = (facts: object[], absences: object[] = []) => ({
  n: 1,
  says: "Her A1c was high in June.",
  why: "It is above the lab's range.",
  confidence: "high",
  facts,
  absences,
});

const replyOf = (items: object[], answer = "Her A1c was 6.6 % in June.") =>
  JSON.stringify({ answer, short: "A1c 6.6 %.", items });

const user = (text: string) => ({
  id: "u1",
  role: "user",
  parts: [{ type: "text", text }],
});

async function chat(
  messages: object[],
  pod: string = POD,
  through: { request: typeof app.request } = app,
) {
  const response = await through.request(`${ORIGIN}/chat`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ pod, page: `/pods/${pod}/`, messages }),
  });
  expect(response.status).toBe(200);
  const chunks: { type: string; [key: string]: unknown }[] = (
    await response.text()
  )
    .split("\n\n")
    .filter((event) => event.startsWith("data: {"))
    .map((event) => JSON.parse(event.slice("data: ".length)));
  const checked = chunks.find(({ type }) => type === "data-reply")?.data as
    CheckedReply | undefined;
  const text = chunks
    .filter(({ type }) => type === "text-delta")
    .map(({ delta }) => delta)
    .join("");
  return { chunks, checked, text };
}

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "reply-test-"));
  await loadSample(join(folder, POD));
  api = podApi(nodeHost({ folder }));
  app = appServer({
    api,
    own: () => ({ hosts: new Set(["app.test"]), origins: new Set([ORIGIN]) }),
    chat: chatRoutes({ api, model }),
    back: () => undefined,
    pages: folder,
  });
}, 120_000);

afterAll(async () => {
  await api?.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 5 });
});

test("a reply naming a handle the pod holds and one it does not comes back with the first filled and checked and the second failed", async () => {
  modelSays(
    says(
      replyOf([
        point([
          { says: "Her A1c", cite: { entry: A1C }, field: "value" },
          { says: "Something else", cite: { entry: NOTHING }, field: "value" },
        ]),
      ]),
    ),
  );
  const { checked, chunks, text } = await chat([
    user("Is there anything I should bring up with Dr. Marsh?"),
  ]);
  const [held, lost] = checked!.items[0]!.facts;
  expect(held!.verdict.ok).toBe(true);
  expect(held!.filled).toMatchObject({
    label: "Hemoglobin A1c/Hemoglobin.total in Blood",
    value: "6.6 %",
    date: "2026-06-15",
  });
  expect(lost!.verdict).toMatchObject({ ok: false, reason: "no such record" });
  expect(lost!.filled).toBeUndefined();
  expect(text).toBe("Her A1c was 6.6 % in June.");
  expect(chunks.filter(({ type }) => type === "text-delta")).toHaveLength(1);
  // The page maps the part by its name, and keeps it in the message for history: named data-reply, never transient,
  // with the answer's text before it and both before the stream's finish.
  const types = chunks.map(({ type }) => type);
  const part = chunks.find(({ type }) => type === "data-reply")!;
  expect(Object.keys(part).sort()).toEqual(["data", "type"]);
  expect(types.indexOf("text-end")).toBeLessThan(types.indexOf("data-reply"));
  expect(types.indexOf("data-reply")).toBeLessThan(types.indexOf("finish"));
});

test.each([
  ["is not JSON", "Her A1c was high in June."],
  [
    "is JSON that breaks the contract",
    JSON.stringify({ answer: "Her A1c was high in June." }),
  ],
])(
  "a reply that %s comes back as text with no citations and the reasons it was not checked",
  async (_, said) => {
    modelSays(says(said));
    const { checked, text } = await chat([user("How is my A1c?")]);
    expect(checked!.errors.length).toBeGreaterThan(0);
    expect(checked!.reply).toBeUndefined();
    expect(checked!.items).toEqual([]);
    expect(text).toBe("Her A1c was high in June.");
    expect(mock.doStreamCalls).toHaveLength(2);
  },
);

test.each([
  ["is not JSON", says("Her A1c was high in June.")],
  [
    "breaks the contract",
    says(JSON.stringify({ answer: "Her A1c was high in June." })),
  ],
  [
    "says recommend in its own voice",
    says(
      replyOf(
        [point([{ says: "Her A1c", cite: { entry: A1C }, field: "value" }])],
        "The lab recommended a repeat A1c.",
      ),
    ),
  ],
])(
  "a reply after the tools that %s is asked for once more, with why, and the second is checked",
  async (_, first) => {
    const procedures = { pod: POD, question: "pod/My procedures" };
    modelSays(
      calls("ask", procedures),
      first,
      says(
        replyOf([
          point([{ says: "Her A1c", cite: { entry: A1C }, field: "value" }]),
        ]),
      ),
    );
    const { checked, text } = await chat([user("How is my A1c?")]);
    expect(checked!.errors).toEqual([]);
    expect(checked!.items[0]!.facts[0]!.verdict.ok).toBe(true);
    expect(text).toBe("Her A1c was 6.6 % in June.");
    expect(mock.doStreamCalls).toHaveLength(3);
    const asked = mock.doStreamCalls[2]!.prompt;
    const again = asked.at(-1)!;
    expect(again.role).toBe("user");
    expect(JSON.stringify(again.content)).toContain("Reply again");
    expect(asked.map(({ role }) => role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "assistant",
      "user",
    ]);
  },
);

test("an absence is backed by the calls this request ran, never by a tool's output the page sends back", async () => {
  const procedures = { pod: POD, question: "pod/My procedures" };
  const absent = replyOf([
    point(
      [],
      [
        {
          what: "a mammogram",
          match: { terms: ["mammogram"] },
          coverage: "her procedures",
          query: { tool: "ask", input: procedures },
        },
      ],
    ),
  ]);
  modelSays(calls("ask", procedures), says(absent));
  const ran = await chat([user("Has she had a mammogram?")]);
  expect(ran.checked!.items[0]!.absences[0]!.backing).toEqual({ backed: true });

  modelSays(says(absent));
  const sent = await chat([
    user("Has she had a mammogram?"),
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-ask",
          toolCallId: "call-0",
          state: "output-available",
          input: procedures,
          output: { question: procedures.question, total: 0, rows: [] },
        },
      ],
    },
  ]);
  expect(sent.checked!.items[0]!.absences[0]!.backing).toMatchObject({
    backed: false,
    reason: "query not run",
  });
});

test("with no pod open, the pod the model read is the one the reply is checked against, and with none read it is not checked", async () => {
  const cited = replyOf([
    point([{ says: "Her A1c", cite: { entry: A1C }, field: "value" }]),
  ]);
  modelSays(
    calls("ask", { pod: POD, question: "pod/My procedures" }),
    says(cited),
  );
  const read = await chat([user("How is my A1c?")], "");
  expect(read.checked!.items[0]!.facts[0]!.verdict.ok).toBe(true);

  modelSays(says(cited));
  const unread = await chat([user("How is my A1c?")], "");
  expect(unread.checked).toMatchObject({ items: [] });
  expect(unread.checked!.errors).toHaveLength(1);
  expect(unread.text).toBe("Her A1c was 6.6 % in June.");
  expect(mock.doStreamCalls).toHaveLength(1);
});

test("a pod that cannot be read leaves the reply unchecked, with its answer", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { answer, checked } = await repliedTo(
    replyOf([point([{ says: "x", cite: { entry: A1C }, field: "value" }])]),
    {
      ask: asker(() => Promise.reject(new Error("the pod is locked"))),
      ran: [],
    },
  );
  error.mockRestore();
  expect(answer).toBe("Her A1c was 6.6 % in June.");
  expect(checked.errors).toHaveLength(1);
  expect(checked.items).toEqual([]);
});

test("a model that says nothing is shown as having given no reply", async () => {
  const { answer } = await repliedTo("  ", { ask: undefined, ran: [] });
  expect(answer).toBe("The model gave no reply.");
});

test("the model is asked in the runtime's contract, and told to ask, not to recommend", async () => {
  modelSays(says(replyOf([])));
  await chat([user("What should I ask?")]);
  const [options] = mock.doStreamCalls as [LanguageModelV4CallOptions];
  expect(options.responseFormat).toMatchObject({
    type: "json",
    schema: { title: replySchema.title },
  });
  const system = JSON.stringify(options.prompt[0]);
  expect(system).toContain("Reply, and nothing else, as JSON");
  expect(system).not.toContain("the command printed");
  expect(system).toContain("Never say that you recommend");
  expect(system).toContain(
    "A record's recommendation is given only in its words",
  );
  expect(options.tools?.map(({ name }) => name)).toContain("ask");
});

test("the page's copy of an earlier reply, with its data part, is accepted and only its text reaches the model", async () => {
  modelSays(says(replyOf([])));
  const { chunks } = await chat([
    user("How is my A1c?"),
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "Her A1c was 6.6 % in June." },
        {
          type: "data-reply",
          data: { errors: [], items: [], filler: "x".repeat(150_000) },
        },
      ],
    },
    { ...user("And before June?"), id: "u2" },
  ]);
  expect(chunks.some(({ type }) => type === "error")).toBe(false);
  const prompt = JSON.stringify(mock.doStreamCalls[0]!.prompt);
  expect(prompt).toContain("Her A1c was 6.6 % in June.");
  expect(prompt).not.toContain("filler");
});

test.each([
  [
    "half-written JSON with its answer begun",
    `{"answer":"Her A1c was 6.6 % in Ju`,
    "Her A1c was 6.6 % in Ju",
  ],
  ["half-written JSON before its answer", `{"ans`, "The answer was cut off."],
  [
    "half-written JSON in a code fence",
    '```json\n{"answer":"Her A1c was 6.6 % in Ju',
    "Her A1c was 6.6 % in Ju",
  ],
])(
  "a reply cut off at the length limit with %s never shows the person raw JSON",
  async (_, said, shown) => {
    modelSays(says(said, "length"));
    const { checked, text } = await chat([user("How is my A1c?")]);
    expect(text).toBe(shown);
    expect(checked!.errors.length).toBeGreaterThan(0);
  },
);

test.each(["other", "unknown"] as const)(
  "a model that stops with %s still gets its reply checked and shown",
  async (reason) => {
    modelSays(
      says(
        replyOf([
          point([{ says: "Her A1c", cite: { entry: A1C }, field: "value" }]),
        ]),
        reason as "other",
      ),
    );
    const { checked, text } = await chat([user("How is my A1c?")]);
    expect(text).toBe("Her A1c was 6.6 % in June.");
    expect(checked!.items[0]!.facts[0]!.verdict.ok).toBe(true);
  },
);

test("a reply that says recommend in its own voice is not checked, and one that quotes a record saying it is", async () => {
  const fact = { says: "Her A1c", cite: { entry: A1C }, field: "value" };
  modelSays(
    says(replyOf([point([fact])], "I recommend you see Dr. Marsh sooner.")),
  );
  const own = await chat([user("What should I do?")]);
  expect(own.checked!.errors.length).toBeGreaterThan(0);
  expect(own.checked!.reply).toBeUndefined();
  expect(own.text).toBe("I recommend you see Dr. Marsh sooner.");

  // A quote that failed its check does not excuse the word.
  const words = "we recommend a sooner visit now";
  modelSays(
    says(
      replyOf(
        [point([{ ...fact, field: "text", quote: words }])],
        "The report says " + words,
      ),
    ),
  );
  const failed = await chat([user("What should I do?")]);
  expect(failed.checked!.errors.length).toBeGreaterThan(0);
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
        ...(set.itemLink === undefined
          ? {}
          : { links: [{ from: 1, to: 1, says: set.itemLink }] }),
      },
    ],
    ...(set.link === undefined
      ? {}
      : {
          links: [
            { from: { item: 1, fact: 1 }, to: { item: 1, fact: 1 }, says: set.link },
          ],
        }),
  };
  return {
    errors: [],
    reply,
    items: [{ facts: [{ fact, verdict: { ok: true } }], absences: [] }],
  } as unknown as CheckedReply;
}

test.each([
  ["a passed quote said in the model's own voice", { quote: "recommend rest daily", answer: "I recommend rest daily" }, true],
  ["a quote that is the model's own words, passed", { answer: "I recommend follow-up CT" }, true],
  ["a passed quote inside straight quotation marks, in another case and spacing", { answer: 'I\'d ask about it: the report says "recommend  FOLLOW-UP ct"' }, false],
  ["a passed quote inside curly quotation marks", { answer: "I'd ask about it: the report says “Recommend follow-up CT”" }, false],
  ["a quote and then the word outside the marks", { answer: 'The report says "Recommend follow-up CT" and I recommend it' }, true],
  ["the word in a fact's says", { factSays: "The report recommends a CT" }, true],
  ["the word in an absence's coverage", { coverage: "where one would recommend it" }, true],
  ["the word in a knowledge guideline", { guideline: "Guidelines recommend yearly screening" }, true],
  ["the word in an item's link", { itemLink: "this recommends that" }, true],
  ["the word in a link between items", { link: "this recommends that" }, true],
])("the word recommend is held to quotes that passed: %s", (_, set, flagged) => {
  expect(recommending(checkedWith(set))).toBe(flagged);
});

test("an absence over an earlier request's read is not checked, even when that turn ended in a page tool", async () => {
  const procedures = { pod: POD, question: "pod/My procedures" };
  const absent = replyOf([
    point(
      [],
      [
        {
          what: "a mammogram",
          match: { terms: ["mammogram"] },
          coverage: "her procedures",
          query: { tool: "ask", input: procedures },
        },
      ],
    ),
  ]);
  modelSays(
    streamOf([
      {
        type: "tool-call",
        toolCallId: "call-ask",
        toolName: "ask",
        input: JSON.stringify(procedures),
      },
      finish("tool-calls"),
    ]),
    streamOf([
      {
        type: "tool-call",
        toolCallId: "call-open",
        toolName: "open_pod",
        input: JSON.stringify({ pod: POD }),
      },
      finish("tool-calls"),
    ]),
  );
  const first = await chat([user("Has she had a mammogram?")]);
  expect(first.checked).toBeUndefined();

  modelSays(says(absent));
  const second = await chat([
    user("Has she had a mammogram?"),
    {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-ask",
          toolCallId: "call-ask",
          state: "output-available",
          input: procedures,
          output: { question: procedures.question, total: 0, rows: [] },
        },
        {
          type: "tool-open_pod",
          toolCallId: "call-open",
          state: "output-available",
          input: { pod: POD },
          output: { opened: POD },
        },
      ],
    },
  ]);
  expect(second.checked!.items[0]!.absences[0]!.backing).toMatchObject({
    backed: false,
    reason: "query not run",
  });
});

test("a reply asked for again that still cannot be checked leaves the first shown, and one the model fails to give too", async () => {
  const first = replyOf(
    [point([{ says: "Her A1c", cite: { entry: A1C }, field: "value" }])],
    "The lab recommended a repeat A1c.",
  );
  modelSays(says(first), says("Something else."));
  const worse = await chat([user("How is my A1c?")]);
  expect(worse.text).toBe("The lab recommended a repeat A1c.");
  expect(worse.checked!.errors.length).toBeGreaterThan(0);

  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  let call = 0;
  mock = new MockLanguageModelV4({
    doStream: async () => {
      if (call++ === 0) return says(first);
      throw new Error("the model is gone");
    },
  });
  const failed = await chat([user("How is my A1c?")]);
  error.mockRestore();
  expect(failed.text).toBe("The lab recommended a repeat A1c.");
  expect(failed.chunks.some(({ type }) => type === "error")).toBe(false);
});

test("a reply cut off at the length limit is not asked for again, and the page is not told it is being checked", async () => {
  modelSays(says(`{"answer":"Her A1c was 6.6 % in Ju`, "length"));
  const { chunks, checked, text } = await chat([user("How is my A1c?")]);
  expect(mock.doStreamCalls).toHaveLength(1);
  expect(chunks.some(({ type }) => type === "data-checking")).toBe(false);
  expect(text).toBe("Her A1c was 6.6 % in Ju");
  expect(checked!.errors.length).toBeGreaterThan(0);
});

test("a reply asked for again is asked within a small bound the first was not, and a call to a tool in it runs nothing", async () => {
  const procedures = { pod: POD, question: "pod/My procedures" };
  const ask = vi.spyOn(api, "ask");
  try {
    modelSays(
      calls("ask", procedures),
      says("Her A1c was high in June."),
      calls("ask", procedures),
    );
    const { checked, text } = await chat([user("How is my A1c?")]);
    expect(mock.doStreamCalls).toHaveLength(3);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(mock.doStreamCalls[0]!.maxOutputTokens).toBeUndefined();
    expect(mock.doStreamCalls[1]!.maxOutputTokens).toBeUndefined();
    expect(mock.doStreamCalls[2]!.maxOutputTokens).toBe(16000);
    expect(text).toBe("Her A1c was high in June.");
    expect(checked!.errors.length).toBeGreaterThan(0);
  } finally {
    ask.mockRestore();
  }
});

test("a reply asked for again that is itself cut off leaves the complete first reply shown", async () => {
  const first = replyOf(
    [point([{ says: "Her A1c", cite: { entry: A1C }, field: "value" }])],
    "The lab recommended a repeat A1c.",
  );
  modelSays(
    says(first),
    says(`{"answer":"Her A1c was 6.6 % in Ju`, "length"),
  );
  const { text, checked } = await chat([user("How is my A1c?")]);
  expect(mock.doStreamCalls).toHaveLength(2);
  expect(text).toBe("The lab recommended a repeat A1c.");
  expect(checked!.errors.length).toBeGreaterThan(0);
});

test("the page is told the answer is being checked, in a part never kept, before the model is asked again", async () => {
  let told = false;
  let toldBefore: boolean | undefined;
  mock = new MockLanguageModelV4({
    doStream: async () => {
      if (mock.doStreamCalls.length === 1)
        return says("Her A1c was high in June.");
      for (let waited = 0; !told && waited < 200; waited++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      toldBefore = told;
      return says(
        replyOf([
          point([{ says: "Her A1c", cite: { entry: A1C }, field: "value" }]),
        ]),
      );
    },
  });
  const response = await app.request(`${ORIGIN}/chat`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({
      pod: POD,
      page: `/pods/${POD}/`,
      messages: [user("How is my A1c?")],
    }),
  });
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
  expect(toldBefore).toBe(true);
  const types = all
    .split("\n\n")
    .filter((event) => event.startsWith("data: {"))
    .map((event) => JSON.parse(event.slice("data: ".length)));
  const checking = types.filter(({ type }) => type === "data-checking");
  expect(checking).toHaveLength(1);
  expect(checking[0].transient).toBe(true);
  expect(types.findIndex(({ type }) => type === "data-checking")).toBeLessThan(
    types.findIndex(({ type }) => type === "text-delta"),
  );
});

const ANTHROPIC = "http://anthropic.test";
/** The thinking tokens Haiku spent before its reply in the live probe's last step (#12), with room to spare. */
const THINKING = 5000;

/**
 * Anthropic's Messages API as its stream answers: `THINKING` tokens of thinking, then `text` (a token for every four
 * characters), all counted against the request's `max_tokens`, the text cut off where they run out.
 */
function anthropicSays(text: string, asked: unknown[]) {
  return async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init!.body));
    asked.push(request);
    const room = request.max_tokens - THINKING;
    const whole = room >= Math.ceil(text.length / 4);
    const said = room > 0 ? text.slice(0, room * 4) : "";
    const events: object[] = [
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: request.model,
          content: [],
          stop_reason: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "", signature: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "s" },
      },
      { type: "content_block_stop", index: 0 },
      ...(said === ""
        ? []
        : [
            {
              type: "content_block_start",
              index: 1,
              content_block: { type: "text", text: "" },
            },
            {
              type: "content_block_delta",
              index: 1,
              delta: { type: "text_delta", text: said },
            },
            { type: "content_block_stop", index: 1 },
          ]),
      {
        type: "message_delta",
        delta: { stop_reason: whole ? "end_turn" : "max_tokens" },
        usage: {
          output_tokens: Math.min(
            request.max_tokens,
            THINKING + said.length / 4,
          ),
        },
      },
      { type: "message_stop" },
    ];
    return new Response(
      events
        .map(
          (event) =>
            `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`,
        )
        .join(""),
      { headers: { "content-type": "text/event-stream" } },
    );
  };
}

test("an Anthropic model that thinks at length before its reply still gives the reply whole, and it is checked", async () => {
  const asked: { max_tokens: number }[] = [];
  vi.stubGlobal(
    "fetch",
    anthropicSays(
      replyOf([
        point([{ says: "Her A1c", cite: { entry: A1C }, field: "value" }]),
      ]),
      asked,
    ),
  );
  try {
    const anthropic = chatRoutes({
      api,
      model: modelOf({
        provider: "anthropic",
        url: ANTHROPIC,
        name: "claude-haiku-5-5",
        key: "k",
      }),
    });
    const { checked, text } = await chat(
      [user("Is there anything I should bring up with Dr. Marsh?")],
      POD,
      anthropic,
    );
    expect(asked).toHaveLength(1);
    expect(checked!.errors).toEqual([]);
    expect(checked!.items[0]!.facts[0]!.verdict.ok).toBe(true);
    expect(text).toBe("Her A1c was 6.6 % in June.");
  } finally {
    vi.unstubAllGlobals();
  }
});

test("an Anthropic request marks its system prompt and its last message for the cache, and another provider's does not", async () => {
  const asked: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    anthropicSays(
      replyOf([
        point([{ says: "Her A1c", cite: { entry: A1C }, field: "value" }]),
      ]),
      asked as { max_tokens: number }[],
    ),
  );
  try {
    const anthropic = chatRoutes({
      api,
      model: modelOf({
        provider: "anthropic",
        url: ANTHROPIC,
        name: "claude-haiku-5-5",
        key: "k",
      }),
    });
    await chat([user("How is my A1c?")], POD, anthropic);
    const [request] = asked as {
      system: { cache_control?: unknown }[];
      messages: { content: { cache_control?: unknown }[] }[];
    }[];
    const mark = { type: "ephemeral" };
    expect(request!.system.at(-1)!.cache_control).toEqual(mark);
    const last = request!.messages.at(-1)!;
    expect(last.content.at(-1)!.cache_control).toEqual(mark);
    expect(
      request!.messages
        .slice(0, -1)
        .flatMap(({ content }) => content)
        .some((block) => block.cache_control !== undefined),
    ).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }

  modelSays(says(replyOf([])));
  await chat([user("How is my A1c?")]);
  expect(JSON.stringify(mock.doStreamCalls[0]!.prompt)).not.toContain(
    "cacheControl",
  );
});
