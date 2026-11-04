import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import type { CheckedReply, Reply } from "cascade-runtime";
import { replySchema } from "cascade-runtime";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Model } from "../models.ts";
import { nodeHost } from "../node-host.ts";
import { podApi } from "../pod-api.ts";
import { loadSample, SAMPLE } from "../sample.ts";
import { appServer } from "../server/app.ts";
import { chatRoutes } from "../server/chat.ts";

const ORIGIN = "http://app.test";
const POD = SAMPLE.pod;
/** Priya's HbA1c of 2026-06-15 in the compact read, and a handle that names nothing. */
const A1C = "Lf9c60520";
const NOTHING = "Lffffffff";
let folder: string;
let api: ReturnType<typeof podApi>;
let app: ReturnType<typeof appServer>;
let mock: MockLanguageModelV4;

const finish = (unified: "stop" | "tool-calls") =>
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
  stream: new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      for (const part of [{ type: "stream-start", warnings: [] }, ...parts] as LanguageModelV4StreamPart[])
        controller.enqueue(part);
      controller.close();
    },
  }),
});

/** A step of the model that says `text`: what the reply is, as JSON text. */
const says = (text: string) =>
  streamOf([
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" },
    finish("stop"),
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

/** The model of the next request: each of its steps is the next of `steps`. */
function modelSays(...steps: ReturnType<typeof streamOf>[]) {
  mock = new MockLanguageModelV4({ doStream: steps });
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

async function chat(messages: object[]) {
  const response = await app.request(`${ORIGIN}/chat`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ pod: POD, page: `/pods/${POD}/`, messages }),
  });
  expect(response.status).toBe(200);
  const chunks: { type: string; [key: string]: unknown }[] = (
    await response.text()
  )
    .split("\n\n")
    .filter((event) => event.startsWith("data: {"))
    .map((event) => JSON.parse(event.slice("data: ".length)));
  const checked = chunks.find(({ type }) => type === "data-reply")?.data as
    | CheckedReply
    | undefined;
  const text = chunks
    .filter(({ type }) => type === "text-delta")
    .map(({ delta }) => delta)
    .join("");
  return { chunks, checked, text };
}

/** Where `reply` says "recommend" in its own voice: in its answer, short, or an item's says, why or knowledge, outside a quote. */
function recommending(reply: Reply) {
  const quotes = reply.items.flatMap(({ facts = [] }) =>
    facts.flatMap((fact) => ("quote" in fact && fact.quote ? [fact.quote] : [])),
  );
  const outside = (text: string) =>
    quotes.reduce((rest, quote) => rest.replaceAll(quote, ""), text);
  return [
    reply.answer,
    reply.short,
    ...reply.items.flatMap((item) => [
      item.says,
      item.why,
      item.knowledge?.says ?? "",
    ]),
  ].filter((text) => /recommend/i.test(outside(text)));
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
});

test.each([
  ["is not JSON", "Her A1c was high in June."],
  ["is JSON that breaks the contract", JSON.stringify({ answer: "Her A1c was high in June." })],
])("a reply that %s comes back as text with no citations and the reasons it was not checked", async (_, said) => {
  modelSays(says(said));
  const { checked, text } = await chat([user("How is my A1c?")]);
  expect(checked!.errors.length).toBeGreaterThan(0);
  expect(checked!.reply).toBeUndefined();
  expect(checked!.items).toEqual([]);
  expect(text).toBe("Her A1c was high in June.");
});

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
  expect(options.tools?.map(({ name }) => name)).toContain("ask");
});

test("a reply says 'recommend' only inside a quote of the records", async () => {
  const reply = (says: string, quote?: string) =>
    ({
      answer: says,
      short: "s",
      items: [
        {
          n: 1,
          says,
          why: "w",
          confidence: "high",
          facts: [
            {
              says: "the report",
              cite: { entry: "N1" },
              field: "text",
              ...(quote === undefined ? {} : { quote }),
            },
          ],
        },
      ],
    }) satisfies Reply;
  const report = "Repeat colonoscopy in 10 years; we recommend a sooner visit.";
  expect(
    recommending(reply("The report says: " + report, report)),
  ).toEqual([]);
  expect(recommending(reply("I recommend a sooner visit."))).toHaveLength(2);
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
