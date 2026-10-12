import { describe, expect, it } from "vitest"

import { defaultConfig } from "../src/core/config"
import { renderTemplates } from "../src/core/templates"

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
})
