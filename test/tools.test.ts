import { TOOLS as RUNTIME } from "cascade-runtime/tools";
import { beforeAll, describe, expect, it } from "vitest";
import { NEVER, TOOLS } from "../tools.ts";

/** What each tool is given, and the PodApi operations it may call. A tool added to `TOOLS` needs a row. */
const RUNS: Record<string, [Record<string, unknown>, string[]]> = {
  list_pods: [{}, ["pods"]],
  find_changes: [{ pod: "p" }, ["tool"]],
  finding_rows: [{ pod: "p", key: "k" }, ["tool"]],
  lab_series: [{ pod: "p", test: "t" }, ["tool"]],
  timeline: [{ pod: "p" }, ["tool"]],
  worth_a_look: [{ pod: "p" }, ["tool"]],
  ask: [{ pod: "p", question: "pod/My lab results" }, ["ask"]],
  reference_table_checks: [{ pod: "p" }, ["tables"]],
  open_pod: [{ pod: "p" }, ["pod"]],
  open_trend: [{ pod: "p", test: "t", medication: "m" }, ["trend"]],
  open_entry: [{ pod: "p", entry: "e" }, ["ask"]],
  open_classes: [{ pod: "p" }, ["pod"]],
  open_panel: [{ pod: "p", panel: "24326-1" }, ["pod"]],
  open_table: [{ table: "t" }, ["table"]],
  make_pod: [{ person: "Ann", encrypt: true }, ["makePod"]],
  check_tables: [{}, ["checkTables"]],
  set_world_date: [{ date: "2026-01-01" }, ["setWorldDate"]],
};
const ANSWERS: Record<string, unknown> = {
  pods: { pods: [{ name: "p" }] },
  tool: { value: [], found: [] },
  ask: { rows: [{ entry: "e" }] },
  trend: { series: { test: { notation: "t" } }, timeline: [] },
  tables: undefined,
};
const address = () => "/";

type Called = [string, Record<string, unknown>];

/** Every PodApi operation `tool` calls, with its input, when it runs with the input `RUNS` gives it. */
async function opsCalled(tool: (typeof TOOLS)[number]): Promise<Called[]> {
  const called: Called[] = [];
  const recording = new Proxy(
    {},
    {
      get:
        (_, op: string) =>
        async (given: Record<string, unknown> = {}) => {
          called.push([op, given]);
          return op in ANSWERS ? ANSWERS[op] : {};
        },
    },
  );
  await tool.run(recording as never, RUNS[tool.name]![0], {
    open: async () => {},
    address: {
      pod: address,
      trend: address,
      entry: address,
      classes: address,
      panel: address,
      table: address,
    },
  });
  return called;
}

const code = (names: string[]) => names.map((name) => `\`${name}\``).join(", ");

/**
 * `TOOLS` is the one list every door offers a model: each tool calls only PodApi's operations, and its tier says whether
 * it runs at once (`free`) or only after the person allows it (`ask`). `NEVER` lists the operations no tool may call, such
 * as unlocking a pod, so no model reaches them by any door.
 */
describe("Tools a model reaches the app by · TOOLS, NEVER", () => {
  describe("TOOLS", () => {
    beforeAll(() => {
      expect(
        TOOLS.map(({ name }) => name).sort(),
        "a tool added to `TOOLS` needs a row in `RUNS`",
      ).toEqual(Object.keys(RUNS).sort());
    });

    it("gives every tool the tier `free` or `ask`", () => {
      for (const tool of TOOLS) expect(["free", "ask"], tool.name).toContain(tool.tier);
    });

    it("calls no operation that `NEVER` lists, whichever tool runs", async () => {
      for (const tool of TOOLS)
        for (const [op, given] of await opsCalled(tool))
          expect(
            NEVER.some(
              (never) =>
                never.op === op &&
                (never.with === undefined || given[never.with] !== undefined),
            ),
            `${tool.name} calls ${op}`,
          ).toBe(false);
    });

    it("calls `makePod` without `encrypt` for `make_pod`, even when its input asks to encrypt", async () => {
      const called = await opsCalled(TOOLS.find(({ name }) => name === "make_pod")!);
      expect(RUNS.make_pod![0]).toMatchObject({ encrypt: true });
      expect(called.map(([op]) => op)).toEqual(["makePod"]);
      expect(called[0]![1]).not.toHaveProperty("encrypt");
    });

    it.each(
      Object.entries(RUNS).map(([name, [, ops]]) => [code(ops), `\`${name}\``, name, ops] as const),
    )("calls only %s for %s", async (_ops, _name, name, ops) => {
      const called = await opsCalled(TOOLS.find((tool) => tool.name === name)!);
      expect(called.map(([op]) => op)).toEqual(ops);
    });
  });

  describe("given the read tools of `cascade-runtime/tools`", () => {
    it("offers each under the runtime's own name, description, input schema and `ofPod`", () => {
      for (const { name, description, inputSchema, ofPod } of RUNTIME) {
        const mine = TOOLS.find((tool) => tool.name === name);
        expect(mine, name).toBeDefined();
        expect(
          {
            description: mine?.description,
            inputSchema: mine?.inputSchema,
            ofPod: mine?.ofPod,
          },
          name,
        ).toEqual({ description, inputSchema, ofPod });
      }
    });
  });
});
