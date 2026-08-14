// Lab manifest invariant tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(here, "../paperclip-lab.manifest.json");
const instructionsPath = path.resolve(here, "../../paperclip-lab-agent.md");
const CANONICAL_ROOT = "/home/eduardo/repositorios/paperclip";
const MAC_PREFIX = "/Users/";

function assertCanonicalPath(value, label) {
  assert.ok(typeof value === "string" && value.startsWith(`${CANONICAL_ROOT}/`), `${label} must stay under the canonical root`);
  assert.ok(!value.startsWith(MAC_PREFIX), `${label} must not use a Mac path`);
}

test("lab manifest uses the canonical repository root", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.source.root, CANONICAL_ROOT);
  assertCanonicalPath(manifest.runtime.paperclipHome, "runtime.paperclipHome");
  assertCanonicalPath(manifest.runtime.instructionsFile, "runtime.instructionsFile");
  assertCanonicalPath(manifest.generatedPaths.evidence, "generatedPaths.evidence");
  assertCanonicalPath(manifest.generatedPaths.runs, "generatedPaths.runs");
  for (const entry of manifest.rollbackAllowlist) assertCanonicalPath(entry, "rollbackAllowlist entry");
});

test("lab bridge keeps the CEO profile", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.deepEqual(manifest.highProfileSnapshot.extraArgs, ["--agent", "sdd-orchestrator-high"]);
  const instructions = readFileSync(instructionsPath, "utf8");
  assert.ok(instructions.includes(CANONICAL_ROOT));
  assert.ok(!instructions.includes(MAC_PREFIX));
  assert.ok(instructions.includes("--agent sdd-orchestrator-high"));
});
