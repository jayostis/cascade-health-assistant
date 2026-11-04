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

const stream = (data: unknown) =>
  [
    { type: "start", messageId: "reply-1" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "Here is what I would raise." },
    { type: "text-end", id: "t1" },
    { type: "data-reply", data },
    { type: "finish" },
  ]
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("")
    .concat("data: [DONE]\n\n");

test("each point of a checked reply is a card, and a chip opens the entry and where it came from", async ({
  page,
}) => {
  await page.route("**/chat", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { provider: "test", name: "stub", local: true },
      });
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: stream(sixPoints()),
    });
  });
  await page.goto(`/pods/${POD}/`);
  await expect(page.locator("body")).toHaveAttribute("data-state", "ready");

  await page.getByLabel("Ask a question").fill("What should I bring up?");
  await page.getByRole("button", { name: "Send" }).click();

  const points = page.locator(".chat .point");
  await expect(points).toHaveCount(4);
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
