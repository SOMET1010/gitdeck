import { describe, expect, it } from "vitest";
import { parseRepositoryInput, shortSha, toneForState } from "../../../src/utils/devCockpit/display";

describe("parseRepositoryInput", () => {
  it("accepts owner/name and GitHub URLs", () => {
    expect(parseRepositoryInput(" SOMET1010/gitdeck ")).toBe("SOMET1010/gitdeck");
    expect(parseRepositoryInput("https://github.com/SOMET1010/gitdeck")).toBe("SOMET1010/gitdeck");
    expect(parseRepositoryInput("github.com/SOMET1010/gitdeck.git")).toBe("SOMET1010/gitdeck");
    expect(parseRepositoryInput("https://github.com/SOMET1010/gitdeck/actions?x=1")).toBe("SOMET1010/gitdeck");
  });

  it("rejects incomplete or invalid input", () => {
    expect(parseRepositoryInput("")).toBeNull();
    expect(parseRepositoryInput("gitdeck")).toBeNull();
    expect(parseRepositoryInput("owner/na me")).toBeNull();
  });
});

describe("toneForState", () => {
  it("maps green, red and unknown evidence to badge tones", () => {
    expect(toneForState("PASS")).toBe("success");
    expect(toneForState("READY")).toBe("success");
    expect(toneForState("FAIL")).toBe("failure");
    expect(toneForState("NOT_READY")).toBe("failure");
    expect(toneForState("UNKNOWN")).toBe("cancelled");
  });
});

describe("shortSha", () => {
  it("keeps seven characters", () => {
    expect(shortSha("6e88ddcb71ba8d7d")).toBe("6e88ddc");
  });
});
