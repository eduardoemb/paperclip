import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function readWorkflow(name) {
  return readFileSync(path.join(repoRoot, ".github/workflows", name), "utf8");
}

test("release workflow delegates stable and canary verification to the reusable workflow", () => {
  const releaseWorkflow = readWorkflow("release.yml");

  assert.match(
    releaseWorkflow,
    /verify_canary:\n\s+if: github\.event_name == 'push'\n\s+uses: \.\/\.github\/workflows\/release-verify\.yml\n\s+with:\n\s+ref: \$\{\{ github\.sha \}\}/,
  );
  assert.match(
    releaseWorkflow,
    /verify_stable:\n\s+if: github\.event_name == 'workflow_dispatch'\n\s+uses: \.\/\.github\/workflows\/release-verify\.yml\n\s+with:\n\s+ref: \$\{\{ inputs\.source_ref \}\}/,
  );
  assert.doesNotMatch(releaseWorkflow, /verify_(?:canary|stable):[\s\S]*?pnpm test:run(?:\n|$)/);
});

test("release verify workflow covers the same split test surface as stable PR verification", () => {
  const verifyWorkflow = readWorkflow("release-verify.yml");

  assert.match(verifyWorkflow, /workflow_call:/);
  assert.match(verifyWorkflow, /node \.\/scripts\/release-package-map\.mjs check/);
  assert.match(verifyWorkflow, /pnpm -r typecheck/);
  assert.match(verifyWorkflow, /pnpm build/);

  for (const group of ["general-server", "general-workspaces-a", "general-workspaces-b"]) {
    assert.match(verifyWorkflow, new RegExp(`group: ${group}`));
  }

  for (const shardIndex of [0, 1, 2]) {
    assert.match(
      verifyWorkflow,
      new RegExp(`group: general-server[\\s\\S]*?shard_index: ${shardIndex}[\\s\\S]*?shard_count: 3`),
    );
  }

  for (const shardIndex of [0, 1, 2, 3, 4]) {
    assert.match(verifyWorkflow, new RegExp(`shard_index: ${shardIndex}[\\s\\S]*?shard_count: 5`));
  }

  assert.match(verifyWorkflow, /pnpm test:run:general -- --group/);
  assert.match(verifyWorkflow, /pnpm test:run:serialized -- --shard-index/);
});

test("release workflow gives verify_canary cancellable job-scope concurrency", () => {
  const releaseWorkflow = readWorkflow("release.yml");

  assert.match(
    releaseWorkflow,
    /verify_canary:\n\s+if: github\.event_name == 'push'\n\s+uses: \.\/\.github\/workflows\/release-verify\.yml\n\s+with:\n\s+ref: \$\{\{ github\.sha \}\}\n\s+concurrency:\n\s+group: release-verify-canary-\$\{\{ github\.ref \}\}\n\s+cancel-in-progress: true/,
    "verify_canary must be cancellable when a newer main push supersedes it",
  );
});

test("release workflow keeps publish jobs non-cancelling and gated on verification", () => {
  const releaseWorkflow = readWorkflow("release.yml");

  assert.match(
    releaseWorkflow,
    /publish_canary:\n\s+if: github\.event_name == 'push'\n\s+needs: verify_canary\n\s+concurrency:\n\s+group: release-publish-canary\n\s+cancel-in-progress: false/,
    "publish_canary must depend on verify_canary and never cancel in progress",
  );

  assert.match(
    releaseWorkflow,
    /publish_stable:\n\s+if: github\.event_name == 'workflow_dispatch' && !inputs\.dry_run\n\s+needs: verify_stable\n\s+concurrency:\n\s+group: release-publish-stable\n\s+cancel-in-progress: false/,
    "publish_stable must depend on verify_stable and never cancel in progress",
  );
});

test("release workflow removes workflow-level serialization in favor of job concurrency", () => {
  const releaseWorkflow = readWorkflow("release.yml");

  assert.doesNotMatch(
    releaseWorkflow,
    /^concurrency:\n\s+group: release-\$\{\{ github\.event_name \}\}/m,
    "workflow-level serialization must be removed so superseded verification can cancel",
  );
});

test("release verify workflow runs every install with --frozen-lockfile", () => {
  const verifyWorkflow = readWorkflow("release-verify.yml");

  const installs = verifyWorkflow.match(/run: pnpm install[^\n]*/g) ?? [];
  assert.equal(installs.length, 4, "expected the four release-verify jobs to each install dependencies");
  for (const install of installs) {
    assert.match(install, /--frozen-lockfile/);
    assert.doesNotMatch(install, /--no-frozen-lockfile/);
  }
});
