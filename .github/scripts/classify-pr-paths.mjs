#!/usr/bin/env node
/**
 * classify-pr-paths.mjs
 *
 * Dependency-free, fail-open classifier that decides whether a PR's changed
 * paths can affect the canary dry-run or the e2e shard jobs.
 *
 * The classifier is deliberately conservative: it only skips coverage for an
 * explicit set of harmless roots (docs, releases, issue templates, agent/claude
 * config). UI sources are e2e-only (a UI change does not exercise the release
 * canary pipeline; the spec scenario keeps canary skipped unless release-tooling
 * paths also changed). Any other runtime code, manifest, unknown, or empty input
 * runs BOTH jobs, so an incomplete path set can never silently drop required
 * coverage.
 *
 * Exports:
 *   classifyPrPaths(paths) -> { canary: boolean, e2e: boolean }
 *
 * CLI (used by the pr.yml `policy` job):
 *   changed paths on stdin (one per line) -> writes `canary_relevant` and
 *   `e2e_relevant` to $GITHUB_OUTPUT when set, and mirrors them to stdout.
 *   Always exits 0 (fail-open) so the gating job can never be the blocker.
 */

import { appendFileSync, readFileSync } from "node:fs";

// Paths that can never affect canary or e2e behavior. Markdown at the repo
// root only; a README inside a runtime tree stays relevant.
const HARMLESS_PATTERNS = [
  /^doc\//,
  /^docs\//,
  /^releases\//,
  /^[^/]+\.md$/,
  /^\.github\/ISSUE_TEMPLATE\//,
  /^\.agents\//,
  /^\.claude\//,
];

// Canary-only: release/build/package scripts and release workflows. Changing
// these cannot affect the e2e lane.
const CANARY_ONLY_PATTERNS = [
  /^scripts\/(release|build|package)\./,
  /^\.github\/workflows\/release.*\.yml$/,
];

// E2e-only: UI sources and e2e specs plus their workflow wiring. Changing these
// cannot affect the release canary dry-run (spec priority over the earlier
// design both-true classification for ui/**).
const E2E_ONLY_PATTERNS = [
  /^ui\//,
  /^tests\/e2e\//,
  /^scripts\/e2e-/,
  /^\.github\/workflows\/(pr|e2e)\.yml$/,
];

function normalize(raw) {
  return String(raw).replace(/\\/g, "/").replace(/^\.\//, "");
}

export function classifyPrPaths(paths) {
  // Fail-open: empty or missing input means we cannot prove irrelevance, so run
  // both jobs rather than risk silent coverage loss.
  if (!paths || paths.length === 0) {
    return { canary: true, e2e: true };
  }

  let canary = false;
  let e2e = false;

  for (const raw of paths) {
    const filePath = normalize(raw);
    if (HARMLESS_PATTERNS.some((pattern) => pattern.test(filePath))) continue;
    if (CANARY_ONLY_PATTERNS.some((pattern) => pattern.test(filePath))) {
      canary = true;
      continue;
    }
    if (E2E_ONLY_PATTERNS.some((pattern) => pattern.test(filePath))) {
      e2e = true;
      continue;
    }
    canary = true;
    e2e = true;
  }

  return { canary, e2e };
}

function main() {
  const input = readFileSync(0, "utf8");
  const paths = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const { canary, e2e } = classifyPrPaths(paths);
  const outputs = {
    canary_relevant: String(canary),
    e2e_relevant: String(e2e),
  };

  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    appendFileSync(
      outputPath,
      `${Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")}\n`,
    );
  }

  for (const [key, value] of Object.entries(outputs)) {
    process.stdout.write(`${key}=${value}\n`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
