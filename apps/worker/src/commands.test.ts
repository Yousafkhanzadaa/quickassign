import { describe, expect, it } from "vitest";
import { parseCommand } from "./commands.js";

describe("parseCommand", () => {
  it.each([
    ["solve", { type: "solve" }],
    ["Solve!", { type: "solve" }],
    ["haan", { type: "solve" }],
    ["qa solve 12", { type: "solve", taskNo: 12 }],
    ["/qa solve #7", { type: "solve", taskNo: 7 }],
    ["QA: skip 3", { type: "skip", taskNo: 3 }],
    ["nahi", { type: "skip" }],
    ["qa status", { type: "status" }],
    ["qa", { type: "help" }],
    ["qa help", { type: "help" }],
    ["what is this", { type: "unknown" }],
  ])("%s", (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });
});
