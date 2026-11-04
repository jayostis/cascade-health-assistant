import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// The model is stubbed at the wire: GET /chat names one and POST /chat answers with the UI message stream the server
// sends for a checked reply (a text part and a `data-reply` part). The reply is Priya's pod's, checked by the runtime.
const checked = JSON.parse(
  readFileSync(
    new URL("../src/chat/checked-reply.fixture.json", import.meta.url),
    "utf8",
  ),
) as {
  items: { n: number }[];
  reply: { items: { n: number }[] };
};
const POD = "priya-natarajan-eval-case";
const TSH_ID =
  "0d8c933a39c754242aa4fb5a1032cfc8be460f67170efed924b99acf15b13f2e";

/** The reply with its three points drawn twice over, so that some are beyond the first four. */
const sixPoints = () => {
  const again = <T extends { n: number }>(items: T[]) =>
    [...items, ...items].map((each, at) => ({ ...each, n: at + 1 }));
  return {
    ...checked,
    items: again(checked.items),
    reply: { ...checked.reply, items: again(checked.reply.items) },
  };
};

const toStream = (chunks: unknown[]) =>
  chunks
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("")
    .concat("data: [DONE]\n\n");

/** Five changes with not enough results around one medication, which the reply does not cite (Jay's first live chat). */
const thin = (test: string, code: string) => ({
  key: `thin-${code}`,
  kind: "medication-started",
  direction: "not enough results",
  unit: "mg/dL",
  test: { code, name: test },
  medication: { name: "ondansetron 4 MG Disintegrating Oral Tablet" },
  before: { count: 0, mean: 0, min: 0, max: 0 },
  after: { count: 1, mean: 4, min: 4, max: 4 },
  rows: [
    {
      entry: `row-${code}`,
      performed: "2026-03-06T08:00:00Z",
      value: "4",
      unit: "mg/dL",
      side: "after",
    },
  ],
});
const LOOKED = [
  thin("Creatinine", "2160-0"),
  thin("Sodium", "2951-2"),
  thin("Potassium", "2823-3"),
  thin("Glucose", "2345-7"),
  thin("Calcium", "17861-6"),
];

/** The model's look at the pod: one tool step, answered, so that the page asks the model again. */
const looking = () =>
  toStream([
    { type: "start", messageId: "reply-1" },
    { type: "start-step" },
    {
      type: "tool-input-available",
      toolCallId: "call-1",
      toolName: "find_changes",
      input: { pod: POD, medication: "ondansetron" },
    },
    { type: "tool-output-available", toolCallId: "call-1", output: LOOKED },
    { type: "finish-step" },
    { type: "finish" },
  ]);

/** The reply, once the model has what it looked at: a text part and the checked reply's `data-reply` part. */
const stream = (data: unknown) =>
  toStream([
    { type: "start", messageId: "reply-1" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "Here is what I would raise." },
    { type: "text-end", id: "t1" },
    { type: "data-reply", data },
    { type: "finish" },
  ]);

test("a turn shows its progress, then the answer and its cards, with what it looked at folded; a chip opens the entry and where it came from", async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let asked = 0;
  await page.route("**/chat", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { provider: "test", name: "stub", local: true },
      });
    asked += 1;
    if (asked > 1) await held;
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: asked === 1 ? looking() : stream(sixPoints()),
    });
  });
  await page.goto(`/pods/${POD}/`);
  await expect(page.locator("body")).toHaveAttribute("data-state", "ready");

  await page.getByLabel("Ask a question").fill("What should I bring up?");
  await page.getByRole("button", { name: "Send" }).click();

  // The model has looked and is writing: a line says so, with Stop; no finding is a card and no answer is drawn yet.
  const working = page.locator(".chat .working");
  await expect(working).toContainText("Putting the answer together");
  await expect(working.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.locator(".chat .card, .chat .point")).toHaveCount(0);
  await expect(page.locator(".chat")).not.toContainText(
    "not enough results around",
  );
  await expect(page.locator(".chat")).not.toContainText(
    "Here is what I would raise.",
  );

  release();
  await expect(working).toHaveCount(0);

  const points = page.locator(".chat .point");
  await expect(points).toHaveCount(4);

  // The answer, then its cards, then what it looked at, folded; the five changes are never cards of their own.
  const answer = page.getByText("Here is what I would raise.");
  const folded = page.locator(".chat .looked-at");
  const at = async (target: typeof answer) =>
    (await target.boundingBox())!.y;
  expect(await at(answer)).toBeLessThan(await at(points.first()));
  expect(await at(points.last())).toBeLessThan(await at(folded));
  await expect(folded.locator("summary")).toHaveText(
    "What it looked at (1 step)",
  );
  await expect(folded).not.toHaveAttribute("open");
  await expect(page.locator(".chat .card")).toHaveCount(0);
  await folded.locator("summary").click();
  await expect(folded).toContainText(
    "Looked at lab results after ondansetron",
  );
  await expect(folded.locator(".thin")).toHaveText(
    "Not enough results to compare: Creatinine, Sodium, Potassium, Glucose, Calcium around ondansetron 4 MG Disintegrating Oral Tablet",
  );
  await folded.locator("summary").click();

  await expect(points.first().locator(".chip.confirmed").first()).toContainText(
    "Thyrotropin",
  );
  await expect(
    points.first().locator(".chip.unconfirmed").first(),
  ).toContainText("couldn't confirm");
  await expect(points.first().locator(".absence").first()).toContainText(
    "Searched: codes 3016-3, 3024-7 · after Mar 6, 2026",
  );
  await expect(points.first().locator(".knowledge")).toContainText(
    "General information, not from your records",
  );

  await page.getByRole("button", { name: "Show items 5 to 6" }).click();
  await expect(points).toHaveCount(6);

  await points.first().locator(".chip.confirmed").first().click();
  await expect(page).toHaveURL(new RegExp(`/entries/${TSH_ID}$`));
  await expect(
    page.getByRole("heading", { name: "Where it came from" }),
  ).toBeVisible();
  await expect(page.getByText("Kestrel Harbor Hospital").first()).toBeVisible();
});
