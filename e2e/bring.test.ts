import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

// A pod made with no name, then brought a hospital's record through the page, as a person does. The app is the one
// `npm start` serves over `pods/`; the pod is made beside the sample while it runs, and removed after.
const POD = "walker-test";
const run = promisify(execFile);

test.afterAll(async () => {
  await rm(new URL(`../pods/${POD}`, import.meta.url), {
    recursive: true,
    force: true,
    maxRetries: 5,
  });
});

test("A pod made with no name is named for the person of the record brought into it", async ({
  page,
}) => {
  await run(process.execPath, ["pod.ts", "new", POD]);
  await page.goto(`/pods/${POD}/`);
  await page.getByRole("link", { name: "Find a hospital" }).click();
  await page
    .getByRole("heading", { name: "Cascade North" })
    .locator("xpath=..")
    .getByRole("button", { name: "Sign in" })
    .click();
  await page.getByLabel("Calloway, Ines").check();
  await page.getByRole("button", { name: "Allow" }).click();
  const box = page.locator("#connection");
  await box.getByRole("button", { name: /^Bring / }).waitFor();
  // The box's two paragraphs are two elements: `innerText` puts a space between them, `textContent` none.
  expect(await box.innerText()).toMatch(
    /This record is Ines Calloway's\. Bringing it in makes this Ines Calloway's pod\./,
  );
  await box.getByRole("button", { name: /^Bring / }).click();
  await page
    .locator("main .note", { hasText: /^Brought in the record from / })
    .waitFor({ timeout: 60_000 });

  /** What the page names the pod: its heading, its entry in the sidebar and its tab. */
  const named = async () => ({
    heading: (await page.locator("main h1").first().textContent())?.trim(),
    sidebar: (
      await page.locator(`aside nav a[href="/pods/${POD}/"]`).textContent()
    )?.trim(),
    tab: /Ines Calloway/.test(await page.title()),
  });
  const ines = { heading: "Ines Calloway", sidebar: "Ines Calloway", tab: true };
  expect(await named()).toEqual(ines);
  await page.reload();
  await page.locator("main h1", { hasText: /\S/ }).first().waitFor();
  expect(await named()).toEqual(ines);
});
