import { describe, expect, it } from "vitest";
import { isCandidate, type PrefilterInput } from "./prefilter.js";

const base: PrefilterInput = { kind: "text", text: "", senderIsAdmin: false, senderRole: "unknown" };
const msg = (over: Partial<PrefilterInput>): PrefilterInput => ({ ...base, ...over });

describe("prefilter", () => {
  it.each([
    "Assignment 3 is uploaded, submit by Monday 11:59 pm",
    "DSA lab task 4: implement a linked list. Deadline Friday",
    "Quiz 2 will be held next week on chapter 5",
    "Solve Q1 to Q5 from exercise 3.2 and submit tomorrow",
    "Sab ne assignment kal tak jama karwana hai",
    "Project report submit krna hai parson tak",
    "اسائنمنٹ کل تک جمع کروانی ہے",
    "Midterm on 14th October, syllabus till lecture 9",
  ])("flags %s", (text) => {
    expect(isCandidate(msg({ text }))).toBe(true);
  });

  it.each(["ok", "Thanks sir", "JazakAllah khair", "👍", "Is the class at 10?", "anyone has notes of lecture 3"])(
    "ignores %s",
    (text) => {
      expect(isCandidate(msg({ text }))).toBe(false);
    },
  );

  it("flags assignment-like PDFs even without text", () => {
    expect(isCandidate(msg({ kind: "document", text: "", fileName: "Assignment_2_OS.pdf", mime: "application/pdf" }))).toBe(true);
  });

  it("flags instructor documents and captioned images", () => {
    expect(isCandidate(msg({ kind: "document", fileName: "week5.pdf", mime: "application/pdf", senderRole: "instructor" }))).toBe(true);
    expect(isCandidate(msg({ kind: "image", text: "Solve these by Monday", senderRole: "class_rep" }))).toBe(true);
  });

  it("trusts instructor announcements more than student chatter", () => {
    const text = "Submit the report";
    expect(isCandidate(msg({ text, senderRole: "instructor" }))).toBe(true);
    expect(isCandidate(msg({ text: "report?", senderRole: "student" }))).toBe(false);
  });
});
