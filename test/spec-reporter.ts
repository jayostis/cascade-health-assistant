// Writes the run as a JUnit report that a page of the app's tests is built from: Vitest's own JUnit has no line for a
// case and none of the prose above a describe, and the page wants both. Set in `vitest.config.ts`; it is no test.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type {
  Reporter,
  TestCase,
  TestModule,
  TestSuite,
  Vitest,
} from "vitest/node";

const escape = (text: string): string =>
  text
    .replace(/[\0-\x08\v\f\x0E-\x1F]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\n", "&#10;");

const attributes = (values: Record<string, string | number | undefined>) =>
  Object.entries(values)
    .flatMap(([name, value]) =>
      value === undefined ? [] : [` ${name}="${escape(String(value))}"`],
    )
    .join("");

const property = (name: string, value: string | number) =>
  `<property name="${name}" value="${escape(String(value))}"/>`;

/**
 * The doc comment that ends on the line above the 1-based `line` of `lines`, blank lines between them allowed, as its
 * paragraphs of prose: lines joined with a space, paragraphs with a blank line. Nothing when there is none.
 */
export function docOf(lines: readonly string[], line: number): string | undefined {
  let end = line - 2;
  while (end >= 0 && lines[end]?.trim() === "") end -= 1;
  if (!lines[end]?.trim().endsWith("*/")) return undefined;
  let start = end;
  while (start >= 0 && !lines[start]!.trim().startsWith("/*")) start -= 1;
  if (start < 0 || !lines[start]!.trim().startsWith("/**")) return undefined;
  const paragraphs: string[][] = [[]];
  for (const raw of lines.slice(start, end + 1)) {
    const body = raw
      .trim()
      .replace(/^\/\*\*/, "")
      .replace(/\*\/$/, "")
      .replace(/^\*\s?/, "")
      .trim();
    if (body === "") paragraphs.push([]);
    else paragraphs.at(-1)!.push(body);
  }
  const description = paragraphs
    .filter((words) => words.length > 0)
    .map((words) => words.join(" "))
    .join("\n\n");
  return description === "" ? undefined : description;
}

/** The report's `outputFile`, from the config's root; `report/junit.xml` unless the reporter's options say another. */
export default class SpecReporter implements Reporter {
  private root = process.cwd();
  private readonly outputFile: string;
  private readonly sources = new Map<string, string[]>();

  constructor(options: { outputFile?: string } = {}) {
    this.outputFile = options.outputFile ?? "report/junit.xml";
  }

  onInit(vitest: Vitest): void {
    this.root = vitest.config.root;
  }

  onTestRunEnd(
    modules: ReadonlyArray<TestModule>,
    unhandled: ReadonlyArray<{ name?: string; message?: string }>,
  ): void {
    const suites = modules.map((module) => this.suiteOf(module));
    const count = (key: "tests" | "failures" | "skipped") =>
      suites.reduce((sum, suite) => sum + suite[key], 0);
    const mistakes = unhandled.length;
    const { name, version } = JSON.parse(
      readFileSync(resolve(this.root, "package.json"), "utf8"),
    ) as { name: string; version: string };
    const spec = this.specOf();
    const xml = [
      `<?xml version="1.0" encoding="UTF-8" ?>`,
      `<testsuites${attributes({
        name: "vitest tests",
        tests: count("tests") + mistakes,
        failures: count("failures"),
        errors: mistakes,
        time: suites.reduce((sum, suite) => sum + suite.time, 0).toFixed(3),
      })}>`,
      `<properties>${property(
        `package:${name}`,
        JSON.stringify({ name, version, ...(spec === undefined ? {} : { spec }) }),
      )}</properties>`,
      ...suites.map((suite) => suite.xml),
      ...(mistakes === 0
        ? []
        : [
            `<testsuite${attributes({ name: "vitest unhandled errors", tests: mistakes, errors: mistakes })}>`,
            ...unhandled.map(
              ({ name: type, message }) =>
                `<testcase${attributes({ classname: "vitest unhandled errors", name: `${type ?? "Error"}: ${message ?? ""}` })}><error${attributes({ message: message ?? "" })}/></testcase>`,
            ),
            `</testsuite>`,
          ]),
      `</testsuites>`,
      "",
    ].join("\n");
    const file = resolve(this.root, this.outputFile);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, xml);
  }

  private specOf(): unknown {
    try {
      return JSON.parse(
        readFileSync(resolve(this.root, "test", "spec.json"), "utf8"),
      );
    } catch {
      return undefined;
    }
  }

  private linesOf(file: string): string[] {
    let lines = this.sources.get(file);
    if (lines === undefined) {
      try {
        lines = readFileSync(file, "utf8").split(/\r?\n/);
      } catch {
        lines = [];
      }
      this.sources.set(file, lines);
    }
    return lines;
  }

  private suiteOf(module: TestModule) {
    const file = relative(this.root, module.moduleId).replaceAll("\\", "/");
    const lines = this.linesOf(module.moduleId);
    const cases: string[] = [];
    const totals = { tests: 0, failures: 0, skipped: 0, time: 0 };
    const visit = (children: Iterable<TestCase | TestSuite>, levels: TestSuite[]): void => {
      for (const child of children) {
        if (child.type === "suite") {
          for (const error of child.errors()) {
            totals.tests += 1;
            totals.failures += 1;
            cases.push(
              `<testcase${attributes({ classname: file, file, name: `${child.fullName} did not run` })}><failure${attributes({ message: error.message, type: error.name })}>${escape(error.stack ?? error.message)}</failure></testcase>`,
            );
          }
          visit(child.children, [...levels, child]);
          continue;
        }
        const result = child.result();
        const seconds = (child.diagnostic()?.duration ?? 0) / 1000;
        totals.tests += 1;
        totals.time += seconds;
        if (result.state === "failed") totals.failures += 1;
        if (result.state === "skipped") totals.skipped += 1;
        const properties = [
          ...(child.location === undefined ? [] : [property("line", child.location.line)]),
          ...levels.flatMap((level, at) => {
            const described = level.location === undefined ? undefined : docOf(lines, level.location.line);
            return [
              ...(described === undefined ? [] : [property(`describe:${at + 1}:description`, described)]),
              ...(level.location === undefined ? [] : [property(`describe:${at + 1}:line`, level.location.line)]),
            ];
          }),
        ];
        const failures =
          result.state === "failed"
            ? result.errors.map(
                (error) =>
                  `<failure${attributes({ message: error.message, type: error.name })}>${escape(error.stack ?? error.message)}</failure>`,
              )
            : [];
        cases.push(
          `<testcase${attributes({
            classname: file,
            file,
            name: child.fullName,
            time: seconds.toFixed(3),
          })}>${properties.length === 0 ? "" : `<properties>${properties.join("")}</properties>`}${result.state === "skipped" ? "<skipped/>" : ""}${failures.join("")}</testcase>`,
        );
      }
    };
    visit(module.children, []);
    const errors = module.errors();
    for (const error of errors) {
      totals.tests += 1;
      totals.failures += 1;
      cases.push(
        `<testcase${attributes({ classname: file, file, name: `${file} did not load` })}><failure${attributes({ message: error.message })}>${escape(error.stack ?? error.message)}</failure></testcase>`,
      );
    }
    return {
      ...totals,
      xml: [
        `<testsuite${attributes({ name: file, tests: totals.tests, failures: totals.failures, skipped: totals.skipped, time: totals.time.toFixed(3) })}>`,
        ...cases,
        `</testsuite>`,
      ].join("\n"),
    };
  }
}
