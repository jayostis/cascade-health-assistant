// What the tests of the chat share: the AI SDK's mock model in place of a provider (so no key and no network), the
// server with the chat behind it, and a request to it read back as the page reads it. It is no test file.
import { tmpdir } from "node:os";
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import type { CheckedReply } from "cascade-runtime";
import { expect } from "vitest";
import type { Model } from "../models.ts";
import type { podApi } from "../pod-api.ts";
import { appServer } from "../server/app.ts";
import { chatRoutes } from "../server/chat.ts";

export const ORIGIN = "http://app.test";

export const finish = (
  unified: "stop" | "tool-calls" | "length" | "other" | "content-filter",
) =>
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

export const streamOf = (parts: LanguageModelV4StreamPart[]) => ({
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

/** One call of the model, as the mock streams it. */
export type Step = ReturnType<typeof streamOf>;

/** A step of the model that says `text`: what the reply is, as JSON text, and stops as `unified`. */
export const says = (
  text: string,
  unified: "stop" | "length" | "other" | "content-filter" = "stop",
) =>
  streamOf([
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" },
    finish(unified),
  ]);

/** A step of the model that calls `tool` with `input`, under the call's `id`. */
export const calls = (tool: string, input: object, id = "call-1") =>
  streamOf([
    {
      type: "tool-call",
      toolCallId: id,
      toolName: tool,
      input: JSON.stringify(input),
    },
    finish("tool-calls"),
  ]);

/** An item of a reply with `facts` and `absences`, as the contract has it. */
export const point = (facts: object[], absences: object[] = []) => ({
  n: 1,
  says: "Her A1c was high in June.",
  why: "It is above the lab's range.",
  confidence: "high",
  facts,
  absences,
});

/** A reply as the model writes it: JSON text. */
export const replyOf = (items: object[], answer = "Her A1c was 6.6 % in June.") =>
  JSON.stringify({ answer, short: "A1c 6.6 %.", items });

export const user = (text: string) => ({
  id: "u1",
  role: "user",
  parts: [{ type: "text", text }],
});

/**
 * A model of the mock, with its own record of the requests it was asked. Its call number `n` (from 1) is the `n`th of
 * the steps `says(...)` gave it, and any call after them is the last again; or, given `next`, whatever `next(n)` makes.
 */
export function mockModel(next?: (call: number) => Promise<Step>) {
  let steps: Step[] = [];
  const mock: MockLanguageModelV4 = new MockLanguageModelV4({
    doStream: async (): Promise<Step> => {
      const call: number = mock.doStreamCalls.length;
      if (next !== undefined) return next(call);
      return call <= steps.length ? steps[call - 1]! : streamOf(steps.at(-1)!.parts);
    },
  });
  const model: Model = {
    provider: "mock",
    name: "mock-1",
    local: true,
    language: () => mock,
    failure: () => undefined,
  };
  return {
    model,
    says: (...each: Step[]) => {
      steps = each;
    },
    requests: (): LanguageModelV4CallOptions[] => mock.doStreamCalls,
  };
}

/** The app's server with the chat behind it, called with `app.request()`. A pod's page is none of its business here. */
export const chatApp = (api: ReturnType<typeof podApi>, model: Model | undefined) =>
  appServer({
    api,
    own: () => ({ hosts: new Set(["app.test"]), origins: new Set([ORIGIN]) }),
    chat: chatRoutes({ api, model }),
    back: () => undefined,
    pages: tmpdir(),
  });

type App = ReturnType<typeof chatApp>;

/** `POST /chat` as the page makes it, for `pod` with the page's `messages`. */
export const post = (app: App, pod: string, messages: object[]) =>
  app.request(`${ORIGIN}/chat`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ pod, page: `/pods/${pod}/`, messages }),
  });

/** The chunks of a UI message stream a response carries. */
export const chunksOf = (stream: string): { type: string; [key: string]: unknown }[] =>
  stream
    .split("\n\n")
    .filter((event) => event.startsWith("data: {"))
    .map((event) => JSON.parse(event.slice("data: ".length)));

/**
 * A question put to the chat, answered 200 (a guard: a request that is refused is no leaf of the caller's), with the
 * stream's chunks, the data of its `data-reply` part and its text deltas joined.
 */
export async function chat(app: App, messages: object[], pod: string) {
  const response = await post(app, pod, messages);
  expect(response.status).toBe(200);
  const chunks = chunksOf(await response.text());
  const checked = chunks.find(({ type }) => type === "data-reply")?.data as
    | CheckedReply
    | undefined;
  const text = chunks
    .filter(({ type }) => type === "text-delta")
    .map(({ delta }) => delta)
    .join("");
  return { chunks, checked, text };
}
