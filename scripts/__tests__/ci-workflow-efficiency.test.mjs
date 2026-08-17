import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { classifyPrPaths } from "../../.github/scripts/classify-pr-paths.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function readWorkflow(name) {
  return readFileSync(path.join(repoRoot, ".github/workflows", name), "utf8");
}

// Extract one job's text from a workflow by its 2-space-indented id. Returning
// the job keyed by its top-level key makes the contract assertions read clearly.
function extractJob(workflow, wanted) {
  const job = extractAllJobs(workflow).get(wanted);
  assert.ok(job, `pr.yml must define a \`${wanted}\` job`);
  return job;
}

test("commitperclip Dependency Review is advisory (continue-on-error: true)", () => {
  const reviewWorkflow = readWorkflow("commitperclip-review.yml");

  // Dependency Review must not be able to stop the project's own quality and
  // security gates from executing.
  const depReviewBlock = reviewWorkflow.match(
    /(?<block>- name: Dependency Review[\s\S]*?-\s+name: Set up Node)/,
  )?.groups?.block;
  assert.ok(depReviewBlock, "expected a Dependency Review step followed by the next step");
  assert.match(depReviewBlock, /uses: actions\/dependency-review-action/);
  assert.match(depReviewBlock, /continue-on-error:\s*true/);
});

test("pr workflow no longer sets the dead PAPERCLIP_E2E_SKIP_LLM environment variable", () => {
  const prWorkflow = readWorkflow("pr.yml");
  assert.doesNotMatch(prWorkflow, /PAPERCLIP_E2E_SKIP_LLM/);
});

test("classifier marks runtime, manifest, and package paths relevant to both jobs", () => {
  const bothRelevant = [
    "cli/src/main.ts",
    "server/src/route.ts",
    "packages/db/src/schema/user.ts",
    "package.json",
    "packages/shared/package.json",
    ".npmrc",
    "pnpm-workspace.yaml",
    "pnpmfile.cjs",
    "pnpmfile.mjs",
    "patches/react+0.1.0.patch",
  ];
  for (const filePath of bothRelevant) {
    assert.deepEqual(
      classifyPrPaths([filePath]),
      { canary: true, e2e: true },
      `expected both canary and e2e relevance for ${filePath}`,
    );
  }
});

test("classifier marks only canary-relevant paths", () => {
  const canaryOnly = ["scripts/release.sh", "scripts/build.mjs", "scripts/package.mjs", ".github/workflows/release.yml"];
  for (const filePath of canaryOnly) {
    assert.deepEqual(
      classifyPrPaths([filePath]),
      { canary: true, e2e: false },
      `expected canary-only relevance for ${filePath}`,
    );
  }
});

test("classifier marks only e2e-relevant paths", () => {
  const e2eOnly = [
    "ui/src/pages/dashboard.tsx",
    "ui/src/App.tsx",
    "ui/vite.config.ts",
    "tests/e2e/smoke-lab.spec.ts",
    "scripts/e2e-shard.mjs",
    ".github/workflows/pr.yml",
    ".github/workflows/e2e.yml",
  ];
  for (const filePath of e2eOnly) {
    assert.deepEqual(
      classifyPrPaths([filePath]),
      { canary: false, e2e: true },
      `expected e2e-only relevance for ${filePath}`,
    );
  }
});

test("classifier keeps canary relevant when a UI change accompanies a canary path", () => {
  // A UI-only change skips the canary dry run, but the spec scenario allows the
  // canary to run when release-tooling paths also changed ("unless
  // release-tooling paths also changed"). The classifier must combine both
  // signals instead of letting the UI path hide the canary-relevant one.
  assert.deepEqual(classifyPrPaths(["ui/src/App.tsx", "scripts/release.sh"]), { canary: true, e2e: true });
  assert.deepEqual(classifyPrPaths(["scripts/build.mjs", "ui/src/components/Thing.tsx"]), { canary: true, e2e: true });
  assert.deepEqual(classifyPrPaths(["ui/src/App.tsx", ".github/workflows/release.yml"]), { canary: true, e2e: true });
});

test("classifier fails open for unknown paths and empty input", () => {
  const ambiguous = ["src/unknown-tool/compile.ts", "requirements.txt", "CMakeLists.txt", "rake-tool/Rakefile"];
  for (const filePath of ambiguous) {
    assert.deepEqual(
      classifyPrPaths([filePath]),
      { canary: true, e2e: true },
      `expected fail-open for unknown ${filePath}`,
    );
  }
  assert.deepEqual(classifyPrPaths([]), { canary: true, e2e: true }, "empty changed-path set must run both jobs");
  assert.deepEqual(classifyPrPaths(undefined), { canary: true, e2e: true }, "missing input must run both jobs");
});

test("classifier exempts only explicit harmless roots", () => {
  const harmless = [
    "doc/GOAL.md",
    "docs/README.md",
    "releases/v1.0.0.md",
    "README.md",
    "CHANGELOG.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".agents/some-agent/SKILL.md",
    ".claude/settings.json",
  ];
  for (const filePath of harmless) {
    assert.deepEqual(
      classifyPrPaths([filePath]),
      { canary: false, e2e: false },
      `expected harmless for ${filePath}`,
    );
  }
});

test("classifier keeps ambiguous doc-like paths relevant rather than skipping", () => {
  // Only the explicit harmless roots above may skip. A README or doc file under
  // a runtime tree, or a shell-ish md variant, must stay fail-open.
  assert.deepEqual(classifyPrPaths(["packages/foo/README.md"]), { canary: true, e2e: true });
  assert.deepEqual(classifyPrPaths(["server/README.mdx"]), { canary: true, e2e: true });
  assert.deepEqual(classifyPrPaths(["scripts/README.sh"]), { canary: true, e2e: true });
});

test("pr.yml policy exports the canary and e2e relevance outputs", () => {
  const prWorkflow = readWorkflow("pr.yml");
  const policy = extractJob(prWorkflow, "policy");
  assert.match(policy, /canary_relevant: \${{ steps\.classify\.outputs\.canary_relevant }}/m);
  assert.match(policy, /e2e_relevant: \${{ steps\.classify\.outputs\.e2e_relevant }}/m);
  assert.match(policy, /node \.github\/scripts\/classify-pr-paths\.mjs/);
});

test("pr.yml gates canary_dry_run on the canary relevance output", () => {
  const prWorkflow = readWorkflow("pr.yml");
  const canary = extractJob(prWorkflow, "canary_dry_run");
  assert.match(canary, /needs\.policy\.outputs\.canary_relevant == 'true'/);
});

test("pr.yml gates e2e_shards on the e2e relevance output", () => {
  const prWorkflow = readWorkflow("pr.yml");
  const shards = extractJob(prWorkflow, "e2e_shards");
  assert.match(shards, /needs\.policy\.outputs\.e2e_relevant == 'true'/);
});

// Collect every job id plus its text from the workflow's `jobs:` section, so
// contract tests can reason about the whole workflow instead of a single job.
function extractAllJobs(workflow) {
  const jobs = new Map();
  let current = null;
  let inJobs = false;
  for (const line of workflow.split("\n")) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      current = header[1];
      jobs.set(current, []);
      continue;
    }
    if (current && /^\S/.test(line)) current = null;
    if (current) jobs.get(current).push(line);
  }
  const result = new Map();
  for (const [id, lines] of jobs) result.set(id, lines.join("\n"));
  return result;
}

test("pr.yml keeps every required non-optional lane active for an irrelevant PR", () => {
  // The specification requires general tests, serialized tests, and policy
  // checks to stay active even when a PR is irrelevant to canary/e2e. The
  // canonical required lanes come from pr.yml itself: every job that is not one
  // of the two relevance-gated optional jobs must remain ungated so an
  // irrelevant PR still runs it.
  const prWorkflow = readWorkflow("pr.yml");
  const jobs = extractAllJobs(prWorkflow);

  // The two optional jobs are the only relevance-gated lanes.
  assert.match(jobs.get("canary_dry_run"), /^ {4}if: needs\.policy\.outputs\.canary_relevant == 'true'$/m);
  assert.match(jobs.get("e2e_shards"), /^ {4}if: needs\.policy\.outputs\.e2e_relevant == 'true'$/m);

  // Every other lane in pr.yml is required: it must exist and must NOT be
  // gated on a relevance output.
  const requiredLanes = [...jobs.keys()].filter((id) => !["canary_dry_run", "e2e_shards"].includes(id));
  for (const lane of requiredLanes) {
    assert.ok(jobs.has(lane), `pr.yml must define the required lane ${lane}`);
    assert.doesNotMatch(
      jobs.get(lane),
      /^ {4}if:.*needs\.policy\.outputs\.(?:canary|e2e)_relevant/m,
      `required lane ${lane} must not be gated on path relevance`,
    );
  }

  // The spec-named required lanes must be members of that set.
  for (const lane of ["policy", "general_tests", "verify_serialized_server", "typecheck_release_registry", "build", "verify", "e2e"]) {
    assert.ok(requiredLanes.includes(lane), `pr.yml must keep the required lane ${lane} active`);
  }

  // The required-check aggregates keep their stable names and always() logic.
  for (const [lane, needsPattern] of [
    ["verify", /needs: \[typecheck_release_registry, general_tests, build\]/],
    ["e2e", /needs: \[policy, e2e_shards\]/],
  ]) {
    assert.match(jobs.get(lane), /^ {4}name: [A-Za-z0-9_-]+$/m, `aggregate ${lane} must keep its check name`);
    assert.match(jobs.get(lane), /^ {4}if: \$\{\{ always\(\) \}\}$/m, `aggregate ${lane} must run on always()`);
    assert.match(jobs.get(lane), needsPattern, `aggregate ${lane} must keep its needs wiring`);
  }
});
