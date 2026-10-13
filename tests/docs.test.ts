import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  POLICY_BEGIN,
  POLICY_END,
  hasPolicy,
  mergePolicyFile,
  stripPolicy,
  stripPolicyFile,
  upsertPolicy,
} from "../src/core/docs"

const POLICY = "# Reusable subagents\n\nFallback rule.\n"

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "opencode-agents-docs-"))
}

describe("upsertPolicy", () => {
  it("wraps an empty file", () => {
    const out = upsertPolicy("", POLICY)
    expect(out.startsWith(POLICY_BEGIN)).toBe(true)
    expect(out.trimEnd().endsWith(POLICY_END)).toBe(true)
    expect(hasPolicy(out)).toBe(true)
  })

  it("appends to existing content", () => {
    const out = upsertPolicy("# Communication\n\n- English.\n", POLICY)
    expect(out.startsWith("# Communication")).toBe(true)
    expect(out).toContain(POLICY_BEGIN)
    expect(out).toContain("Fallback rule.")
  })

  it("is idempotent", () => {
    const once = upsertPolicy("# Communication\n\n- English.\n", POLICY)
    expect(upsertPolicy(once, POLICY)).toBe(once)
  })

  it("replaces a changed block without duplicating markers", () => {
    const once = upsertPolicy("pre\n", POLICY)
    const twice = upsertPolicy(once, "# New policy\n")
    expect(twice.match(new RegExp(POLICY_BEGIN, "g"))?.length).toBe(1)
    expect(twice).toContain("# New policy")
    expect(twice).not.toContain("Fallback rule.")
  })
})

describe("stripPolicy", () => {
  it("removes the block and collapses blank lines", () => {
    const withBlock = upsertPolicy("# Communication\n\n- English.\n", POLICY)
    const stripped = stripPolicy(withBlock)
    expect(stripped).not.toContain(POLICY_BEGIN)
    expect(stripped).toBe("# Communication\n\n- English.\n")
  })

  it("leaves content without a block untouched", () => {
    expect(stripPolicy("hello\n")).toBe("hello\n")
  })
})

describe("malformed markers", () => {
  it("repairs out-of-order markers without duplicating them", () => {
    const broken = `intro\n${POLICY_END}\nmid\n${POLICY_BEGIN}\n`
    const out = upsertPolicy(broken, POLICY)
    expect((out.match(new RegExp(POLICY_BEGIN, "g")) ?? []).length).toBe(1)
    expect((out.match(new RegExp(POLICY_END, "g")) ?? []).length).toBe(1)
    expect(out).toContain("Fallback rule.")
  })

  it("drops an orphan BEGIN marker", () => {
    const out = upsertPolicy(`intro\n${POLICY_BEGIN}\nstale\n`, POLICY)
    expect((out.match(new RegExp(POLICY_BEGIN, "g")) ?? []).length).toBe(1)
    expect((out.match(new RegExp(POLICY_END, "g")) ?? []).length).toBe(1)
  })
})

describe("inline marker mentions", () => {
  it("does not treat quoted markers as a block", () => {
    const doc = "See `<!-- BEGIN opencode-agents -->` and `<!-- END opencode-agents -->`.\n"
    expect(hasPolicy(doc)).toBe(false)
    expect(stripPolicy(doc)).toBe(doc)
  })

  it("appends a real block without destroying prose that mentions the markers", () => {
    const doc = "- delimited by `<!-- BEGIN opencode-agents -->` / `<!-- END opencode-agents -->`;\n"
    const withBlock = upsertPolicy(doc, POLICY)
    expect(withBlock).toContain(doc.trimEnd())
    expect(withBlock).toContain("Fallback rule.")
    expect(stripPolicy(withBlock)).toBe(doc)
  })
})

describe("policy files", () => {
  it("creates, updates, and strips", () => {
    const dir = tmp()
    const file = path.join(dir, "AGENTS.md")
    expect(mergePolicyFile(file, POLICY)).toBe("created")
    expect(mergePolicyFile(file, POLICY)).toBe("unchanged")
    expect(mergePolicyFile(file, "# New\n")).toBe("updated")
    expect(stripPolicyFile(file)).toBe(true)
    expect(fs.existsSync(file)).toBe(false) // was the only content -> removed
    expect(stripPolicyFile(file)).toBe(false)
  })

  it("keeps unrelated content when stripping", () => {
    const dir = tmp()
    const file = path.join(dir, "AGENTS.md")
    fs.writeFileSync(file, "# Communication\n\n- English.\n")
    mergePolicyFile(file, POLICY)
    expect(stripPolicyFile(file)).toBe(true)
    expect(fs.readFileSync(file, "utf8")).toBe("# Communication\n\n- English.\n")
  })
})
