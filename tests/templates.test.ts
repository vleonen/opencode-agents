import { describe, expect, it } from "vitest"

import { defaultConfig } from "../src/core/config"
import { renderPolicy, renderTemplates } from "../src/core/templates"

describe("renderTemplates", () => {
  const rendered = renderTemplates(defaultConfig("global"))

  it("renders every agent and its twin", () => {
    expect(rendered.map((r) => r.fileName).sort()).toEqual([
      "designer-fallback.md",
      "designer.md",
      "qa-fallback.md",
      "qa.md",
      "reviewer-fallback.md",
      "reviewer.md",
    ])
  })

  it("substitutes the chosen models and leaves no placeholder", () => {
    const cfg = defaultConfig("global")
    for (const r of rendered) {
      expect(r.content).not.toContain("{{")
      const expected = r.kind === "primary" ? cfg.agents[r.role].model : cfg.agents[r.role].fallback
      expect(r.content).toContain(`model: ${expected}`)
    }
  })

  it("gives the twin a different model than the primary", () => {
    for (const role of ["designer", "qa", "reviewer"] as const) {
      const primary = rendered.find((r) => r.fileName === `${role}.md`)
      const twin = rendered.find((r) => r.fileName === `${role}-fallback.md`)
      expect(primary).toBeDefined()
      expect(twin).toBeDefined()
      expect(primary?.content).not.toBe(twin?.content)
      expect(twin?.content).toContain("Fallback twin")
    }
  })

  it("twin differs from primary only in description, model, mode, and hidden", () => {
    const normalize = (s: string): string =>
      s
        .split("\n")
        .filter(
          (l) =>
            !l.startsWith("description:") &&
            !l.startsWith("model:") &&
            !l.startsWith("mode:") &&
            !l.startsWith("hidden:"),
        )
        .join("\n")
    for (const role of ["designer", "qa", "reviewer"] as const) {
      const primary = rendered.find((r) => r.fileName === `${role}.md`)?.content ?? ""
      const twin = rendered.find((r) => r.fileName === `${role}-fallback.md`)?.content ?? ""
      expect(primary.length).toBeGreaterThan(0)
      expect(normalize(twin)).toBe(normalize(primary))
    }
  })

  it("removes the override slot when no permissions are configured", () => {
    for (const r of rendered) expect(r.content).not.toContain("PERMISSION_OVERRIDES")
  })

  it("keeps the qa shell gate before its allows, and the guards last", () => {
    const lines = (rendered.find((r) => r.fileName === "qa.md")?.content ?? "").split("\n")
    const gate = lines.findIndex((l) => l.includes("action: shell") && l.includes('resource: "*"') && l.includes("ask"))
    const firstAllow = lines.findIndex((l) => l.includes('resource: "ls *"'))
    const guard = lines.findIndex((l) => l.includes('resource: "rm -rf /"'))
    expect(gate).toBeGreaterThan(-1)
    expect(firstAllow).toBeGreaterThan(gate)
    expect(guard).toBeGreaterThan(firstAllow)
  })

  it("injects configured overlays into both the agent and its twin, before the guards", () => {
    const cfg = defaultConfig("global")
    const rule = { action: "shell", resource: "vm/vm-ssh.sh *", effect: "allow" as const }
    cfg.agents.qa.permissions = [rule]
    const qa = renderTemplates(cfg).find((r) => r.fileName === "qa.md")?.content ?? ""
    const qaTwin = renderTemplates(cfg).find((r) => r.fileName === "qa-fallback.md")?.content ?? ""
    expect(qa).toContain('resource: "vm/vm-ssh.sh *"')
    expect(qaTwin).toContain('resource: "vm/vm-ssh.sh *"')
    expect(qa).not.toContain("PERMISSION_OVERRIDES")
    // overlay rules precede the template's final destructive guards
    expect(qa.indexOf('resource: "vm/vm-ssh.sh *"')).toBeLessThan(qa.indexOf("rm -rf /"))
  })

  it("renders twins as subagent-only and visible by default", () => {
    for (const role of ["designer", "qa", "reviewer"] as const) {
      const twin = rendered.find((r) => r.fileName === `${role}-fallback.md`)?.content ?? ""
      expect(twin).toContain("mode: subagent")
      expect(twin).toContain("hidden: false")
      const primary = rendered.find((r) => r.fileName === `${role}.md`)?.content ?? ""
      expect(primary).toContain("mode: all")
      expect(primary).not.toContain("hidden:")
    }
  })

  it("honors twinMode and twinHidden", () => {
    const cfg = defaultConfig("global")
    cfg.agents.qa.twinMode = "all"
    cfg.agents.qa.twinHidden = true
    const twin = renderTemplates(cfg).find((r) => r.fileName === "qa-fallback.md")?.content ?? ""
    expect(twin).toContain("mode: all")
    expect(twin).toContain("hidden: true")
  })

  it("omits the twin for a primary-only agent", () => {
    const cfg = defaultConfig("global")
    cfg.agents.qa.fallback = undefined
    const files = renderTemplates(cfg).map((r) => r.fileName)
    expect(files).toContain("qa.md")
    expect(files).not.toContain("qa-fallback.md")
    expect(files).toHaveLength(5)
  })

  it("renders the policy only for roles that have a fallback", () => {
    const cfg = defaultConfig("global")
    cfg.agents.qa.fallback = undefined
    const policy = renderPolicy(cfg)
    expect(policy).toContain("| `designer` | `designer-fallback` |")
    expect(policy).toContain("| `reviewer` | `reviewer-fallback` |")
    expect(policy).not.toContain("qa-fallback")
    expect(policy).not.toContain("{{")
  })

  it("renders an empty policy when no role has a fallback", () => {
    const cfg = defaultConfig("global")
    for (const role of ["designer", "qa", "reviewer"] as const) cfg.agents[role].fallback = undefined
    expect(renderPolicy(cfg)).toBe("")
  })
})
