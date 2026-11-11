import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replySchema } from "cascade-runtime";
import { replayKit } from "cascade-runtime/fixtures";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { modelOf } from "../models.ts";
import { nodeHost } from "../node-host.ts";
import { podApi } from "../pod-api.ts";
import { chat, chatApp, mockModel, ORIGIN, point, post, replyOf, says, user } from "./chat-app.ts";

const POD = "alex-rivera";
/** A reply the contract takes, whose one fact names no record: the check fails it, and the server does not ask again. */
const VALID = replyOf([point([{ says: "x", cite: { entry: "Lffffffff" }, field: "value" }])]);
const ANTHROPIC = "http://anthropic.test";
/** The thinking tokens Haiku spent before its reply in the live probe's last step (#12), with room to spare. */
const THINKING = 5000;

let folder: string;
let api: ReturnType<typeof podApi>;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "chat-test-"));
  await replayKit("alex-rivera", join(folder, POD), { through: "E2" });
  api = podApi(nodeHost({ folder }));
}, 60_000);

afterAll(async () => {
  await api?.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 5 });
});

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
          output_tokens: Math.min(request.max_tokens, THINKING + said.length / 4),
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

/**
 * The chat add-on puts a model behind the server: `POST /chat` sends it a person's question with the tools and the reply
 * contract, and answers with the AI SDK's UI message stream. These tests put the AI SDK's mock model, or a stubbed
 * `fetch`, in place of a provider, so they need no key and no network.
 */
describe("Asking a model about a pod · GET /chat, POST /chat", () => {
  describe("when the page asks which model the chat uses (`GET /chat`)", () => {
    it("returns the model's `provider`, `name` and `local`, and nothing else", async () => {
      const response = await chatApp(api, mockModel().model).request(`${ORIGIN}/chat`);
      expect(await response.json()).toEqual({ provider: "mock", name: "mock-1", local: true });
    });

    it("returns `{}` when no model is set", async () => {
      const response = await chatApp(api, undefined).request(`${ORIGIN}/chat`);
      expect(await response.json()).toEqual({});
    });
  });

  describe("when a person asks a question (`POST /chat`)", () => {
    /** The first request the model was asked, for a question to Alex's pod that it answers with `VALID`. */
    async function firstRequest() {
      const mock = mockModel();
      mock.says(says(VALID));
      await chat(chatApp(api, mock.model), [user("What should I ask?")], POD);
      return mock.requests()[0]!;
    }

    it("asks the model for structured output in the runtime's `replySchema`", async () => {
      expect((await firstRequest()).responseFormat).toMatchObject({
        type: "json",
        schema: { title: replySchema.title },
      });
    });

    it("tells the model to reply as JSON and nothing else, and never to say that it recommends", async () => {
      const system = JSON.stringify((await firstRequest()).prompt[0]);
      expect(system).toContain("Reply, and nothing else, as JSON");
      expect(system).toContain("Never say that you recommend");
      expect(system).toContain("A record's recommendation is given only in its words");
    });

    it("leaves out of the contract the call number that only the evals' model is given", async () => {
      // `PARTS` removes it from the runtime's words by string replacement, which stops matching, with no error, if the runtime rewords them.
      expect(JSON.stringify((await firstRequest()).prompt[0])).not.toContain("the command printed");
    });

    it("leaves the call number out of the contract's example too", async () => {
      expect(JSON.stringify((await firstRequest()).prompt[0])).not.toContain('\\"call\\": 3');
    });

    it("answers 400 with `{ error }` for a body of more than 1 MiB, calling no model", async () => {
      const mock = mockModel();
      mock.says(says(VALID));
      const response = await post(chatApp(api, mock.model), POD, [user("x".repeat(1024 * 1024))]);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "the body must be at most 1048576 bytes" });
      expect(mock.requests()).toEqual([]);
    });

    it("answers 400 with `{ error }` for messages of more than 100,000 characters in all, calling no model", async () => {
      const mock = mockModel();
      mock.says(says(VALID));
      const response = await post(chatApp(api, mock.model), POD, [user("x".repeat(100_001))]);
      expect(response.status).toBe(400);
      expect(mock.requests()).toEqual([]);
    });

    it("offers the model the `ask` tool", async () => {
      expect((await firstRequest()).tools?.map(({ name }) => name)).toContain("ask");
    });

    it("answers 503 with `{ error }` naming `npm run model` when no model is set", async () => {
      const response = await post(chatApp(api, undefined), POD, [user("What should I ask?")]);
      expect(response.status).toBe(503);
      expect(((await response.json()) as { error: string }).error).toContain("npm run model");
    });

    it("answers 400 with `{ error }` for a pod the app does not have", async () => {
      const mock = mockModel();
      mock.says(says(VALID));
      const response = await post(chatApp(api, mock.model), "nobody", [user("What should I ask?")]);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "there is no pod nobody" });
      expect(mock.requests()).toEqual([]);
    });
  });

  describe("given the page's copy of an earlier reply", () => {
    /** Two questions and between them an answer whose `data-reply` part holds 150,000 characters of filler. */
    const earlier = [
      user("How is my A1c?"),
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "Her A1c was 6.6 % in June." },
          { type: "data-reply", data: { errors: [], items: [], filler: "x".repeat(150_000) } },
        ],
      },
      { ...user("And before June?"), id: "u2" },
    ];

    it("accepts a `data-reply` part of 150,000 characters, with no `error` part", async () => {
      const mock = mockModel();
      mock.says(says(VALID));
      const { chunks } = await chat(chatApp(api, mock.model), earlier, POD);
      expect(chunks.some(({ type }) => type === "error")).toBe(false);
    });

    it("sends the model the earlier answer's text and nothing of its `data-reply` part", async () => {
      const mock = mockModel();
      mock.says(says(VALID));
      await chat(chatApp(api, mock.model), earlier, POD);
      const prompt = JSON.stringify(mock.requests()[0]!.prompt);
      expect(prompt).toContain("Her A1c was 6.6 % in June.");
      expect(prompt).not.toContain("filler");
    });
  });

  describe("with an Anthropic model", () => {
    let asked: Record<string, unknown>[];
    const anthropic = () =>
      chatApp(api, modelOf({ provider: "anthropic", url: ANTHROPIC, name: "claude-haiku-5-5", key: "k" }));

    beforeEach(() => {
      asked = [];
      vi.stubGlobal("fetch", anthropicSays(VALID, asked));
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("returns the reply whole, in one request, after the model spends 5,000 tokens thinking", async () => {
      // The stub cuts the text off where `max_tokens` less the thinking runs out, so a bound without room fails all three.
      const { checked, text } = await chat(
        anthropic(),
        [user("Is there anything I should bring up with Dr. Marsh?")],
        POD,
      );
      expect(asked).toHaveLength(1);
      expect(text).toBe("Her A1c was 6.6 % in June.");
      expect(checked!.reply).toBeDefined();
      expect(checked!.errors).toEqual([]);
    });

    it("marks the system prompt and the last message for Anthropic's cache, and no earlier message", async () => {
      await chat(
        anthropic(),
        [
          user("How is my A1c?"),
          { id: "a1", role: "assistant", parts: [{ type: "text", text: "Her A1c was 6.6 % in June." }] },
          { ...user("And before June?"), id: "u2" },
        ],
        POD,
      );
      const [request] = asked as unknown as {
        system: { cache_control?: unknown }[];
        messages: { content: { cache_control?: unknown }[] }[];
      }[];
      const mark = { type: "ephemeral" };
      expect(request!.system.at(-1)!.cache_control).toEqual(mark);
      expect(request!.messages.length).toBeGreaterThan(1);
      expect(request!.messages.at(-1)!.content.at(-1)!.cache_control).toEqual(mark);
      expect(
        request!.messages
          .slice(0, -1)
          .flatMap(({ content }) => content)
          .some((block) => block.cache_control !== undefined),
      ).toBe(false);
    });
  });

  describe("with a model of another provider", () => {
    it("sends no cache mark", async () => {
      const mock = mockModel();
      mock.says(says(VALID));
      await chat(chatApp(api, mock.model), [user("How is my A1c?")], POD);
      expect(JSON.stringify(mock.requests()[0]!.prompt)).not.toContain("cacheControl");
    });
  });
});
