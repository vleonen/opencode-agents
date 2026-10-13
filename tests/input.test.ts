import { describe, expect, it } from "vitest"

import { parseModifyRootsInput, parseScopeInput } from "../src/core/input"

describe("parseScopeInput", () => {
  it("accepts p/project and g/global, case-insensitively", () => {
    expect(parseScopeInput("p", "global")).toBe("project")
    expect(parseScopeInput("project", "global")).toBe("project")
    expect(parseScopeInput("PROJECT", "global")).toBe("project")
    expect(parseScopeInput(" g ", "project")).toBe("global")
    expect(parseScopeInput("global", "project")).toBe("global")
  })

  it("keeps the fallback on blank or unknown input", () => {
    expect(parseScopeInput("", "project")).toBe("project")
    expect(parseScopeInput("   ", "global")).toBe("global")
    expect(parseScopeInput("nonsense", "global")).toBe("global")
  })
})

describe("parseModifyRootsInput", () => {
  it("splits on commas and whitespace, keeping `.`", () => {
    expect(parseModifyRootsInput("src, tests ,benchmark")).toEqual(["src", "tests", "benchmark"])
    expect(parseModifyRootsInput("src tests")).toEqual(["src", "tests"])
    expect(parseModifyRootsInput(".")).toEqual(["."])
    expect(parseModifyRootsInput(" , ,")).toEqual([])
    expect(parseModifyRootsInput("")).toEqual([])
  })
})
