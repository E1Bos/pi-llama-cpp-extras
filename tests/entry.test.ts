import { describe, expect, it } from "vitest";
import entry from "../src/index";

describe("extension entry (placeholder)", () => {
  it("default-exports a factory function", () => {
    expect(typeof entry).toBe("function");
  });

  it("the placeholder factory does nothing and returns undefined", () => {
    expect(entry({} as never)).toBeUndefined();
  });
});
