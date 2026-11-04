// `node probe-reply.ts <model> <tries> [<folder>]`: asks the model `.env` names the provider of, renamed `<model>`, the
// probe's question about Priya's pod `<tries>` times through `/chat`, and says of each try whether its reply was
// checked, the checker's errors, and the tokens it cost. Run by hand: it spends money on the key in `.env`. `<folder>`
// holds the pods (a copy of `pods/`, so a try never writes the app's own); every request the provider is sent and
// every answer it streams is kept in `probe-runs/`.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { ENV_FILE, modelOf } from "./models.ts";
import { nodeHost } from "./node-host.ts";
import { podApi } from "./pod-api.ts";
import { chatRoutes } from "./server/chat.ts";

const POD = "priya-natarajan-eval-case";
const QUESTION = "is there anything I should bring up with Dr. Marsh?";

const [name, tries = "1", folder = "pods"] = process.argv.slice(2);
if (!name) {
  console.error("usage: node probe-reply.ts <model> <tries> [<folder>]");
  process.exit(2);
}
process.loadEnvFile(ENV_FILE);
const runs = join("probe-runs", `${name}-${Date.now()}`);
await mkdir(runs, { recursive: true });

interface Call {
  request: unknown;
  response: string;
}
let calls: Call[] = [];
const fetched = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const response = await fetched(input, init);
  if (typeof init?.body !== "string") return response;
  const call: Call = { request: JSON.parse(init.body), response: "" };
  calls.push(call);
  const [mine, theirs] = response.body!.tee();
  void new Response(mine).text().then((text) => (call.response = text));
  return new Response(theirs, response);
};

/** Each SSE event's data of a stream's text. */
const events = (text: string) =>
  text
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice("data: ".length)));

const model = modelOf({
  provider: process.env.CASCADE_MODEL_PROVIDER!,
  url: process.env.CASCADE_MODEL_URL,
  name,
  key: process.env.CASCADE_MODEL_KEY,
});
const api = podApi(nodeHost({ folder }));
const chat = chatRoutes({ api, model });
const tally = { input: 0, output: 0, valid: 0 };

for (let at = 1; at <= Number(tries); at++) {
  calls = [];
  const response = await chat.request("http://app.test/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pod: POD,
      page: `/pods/${POD}/`,
      messages: [
        { id: "u1", role: "user", parts: [{ type: "text", text: QUESTION }] },
      ],
    }),
  });
  const streamed = events(await response.text());
  await new Promise((done) => setTimeout(done, 100));
  const reply = streamed.find(({ type }) => type === "data-reply")?.data;
  const failed = streamed.filter(({ type }) => type === "error");
  const finish = streamed.find(({ type }) => type === "finish");
  const usage = calls.map(({ response }) =>
    events(response).reduce(
      (sum, event) => ({
        input:
          sum.input +
          (event.message?.usage?.input_tokens ?? 0) +
          (event.message?.usage?.cache_creation_input_tokens ?? 0) +
          (event.message?.usage?.cache_read_input_tokens ?? 0),
        output: sum.output + (event.usage?.output_tokens ?? 0),
      }),
      { input: 0, output: 0 },
    ),
  );
  const input = usage.reduce((sum, { input }) => sum + input, 0);
  const output = usage.reduce((sum, { output }) => sum + output, 0);
  tally.input += input;
  tally.output += output;
  const valid = reply !== undefined && reply.errors.length === 0;
  if (valid) tally.valid++;
  console.log(
    JSON.stringify({
      try: at,
      calls: calls.length,
      finish: finish?.finishReason,
      again: calls
        .map(({ request }) =>
          (
            request as { messages: { role: string; content: unknown }[] }
          ).messages.at(-1)!,
        )
        .filter(
          ({ role, content }) =>
            role === "user" && JSON.stringify(content).includes("Reply again"),
        )
        .map(({ content }) => JSON.stringify(content).slice(0, 160)),
      checked: reply === undefined ? "no reply" : valid,
      items: reply?.items?.length,
      errors: reply?.errors,
      failed: failed.map(({ errorText }) => errorText),
      input,
      output,
    }),
  );
  await writeFile(
    join(runs, `try-${at}.json`),
    JSON.stringify({ calls, streamed }, null, 1),
  );
}
console.log(
  JSON.stringify({ model: name, tries: Number(tries), ...tally, runs }),
);
await api.close();
