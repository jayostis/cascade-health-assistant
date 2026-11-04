import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { nodeHost } from "../node-host.ts";
import { podApi } from "../pod-api.ts";
import { digestOf, loadSample, SAMPLE } from "../sample.ts";

test("the sample's downloads are the ones the evals' case was written against", async () => {
  expect(await digestOf(SAMPLE.downloads)).toBe(SAMPLE.sha256);
});

test("the sample loads as a pod of its own, refusing only the two downloads the case plants", async () => {
  const folder = await mkdtemp(join(tmpdir(), "sample-test-"));
  try {
    const done = await loadSample(join(folder, SAMPLE.pod));
    expect(done.map(({ download }) => download)).toEqual([...SAMPLE.imports]);
    expect(
      done.filter(({ refused }) => refused !== undefined).map(({ download }) => download),
    ).toEqual(["export_cda.xml", "kestrel-harbor-health-summary-4.xml"]);
    const api = podApi(nodeHost({ folder }));
    try {
      const { pods } = await api.pods();
      expect(pods.map(({ name }) => name)).toEqual([SAMPLE.pod]);
      const { answers } = await api.answers({ pod: SAMPLE.pod });
      expect(
        answers["pod/What each import brought in"].length,
      ).toBeGreaterThan(0);
    } finally {
      await api.close();
    }
  } finally {
    await rm(folder, { recursive: true, force: true, maxRetries: 5 });
  }
}, 120_000);
