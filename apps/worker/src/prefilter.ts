// Cheap, deterministic pre-filter that decides which group messages are worth an LLM
// call. Tuned for recall: a false positive costs a fraction of a cent, a miss costs a
// student an assignment. Handles English, Roman Urdu and Urdu script.
import type { MsgKind, SenderRole } from "@qa/core";

export interface PrefilterInput {
  kind: MsgKind;
  text: string;
  fileName?: string | null;
  mime?: string | null;
  senderIsAdmin: boolean;
  senderRole: SenderRole;
}

export const CANDIDATE_THRESHOLD = 3;

const STRONG = [
  // English
  /\bassign?ments?\b/i, /\bassig?nment\b/i, /\bassgn?\b/i, /\basgn\b/i, /\bhome\s?works?\b/i, /\bhw\s?\d*\b/i,
  /\bprojects?\b/i, /\blab\s?(task|report|manual|work|assignment|\d+)\b/i, /\btasks?\s?#?\d+\b/i,
  /\bexercises?\b/i, /\bproblem\s?sets?\b/i, /\bworksheets?\b/i, /\btutorial\s?sheets?\b/i,
  /\bcase\s?stud(y|ies)\b/i, /\bpresentations?\b/i, /\breports?\b/i, /\bquiz(zes)?\b/i,
  /\bmid[-\s]?terms?\b/i, /\bfinals?\b/i, /\bexams?\b/i, /\bviva\b/i,
  /\bsubmi(t|ssion|tted)\b/i, /\bdead\s?line\b/i, /\bdue\b/i, /\blast\s?date\b/i,
  /\bq\s?\d{1,2}\b/i, /\bquestions?\s?(no\.?)?\s?\d+/i, /\bsolve\b/i, /\bmarks?\b/i,
  // Roman Urdu
  /\bjama\s?(karwa|krwa|kar|kr)/i, /\bsubmit\s?(karna|krna|karwana|krwana|kar|kr)\b/i,
  /\b(karna|krna|banana|likhna|tayar\s?karna)\s?(hai|hy|he|h)\b/i, /\bakh(i|ee)ri\s?(date|tareekh|tarikh)\b/i,
  // Urdu script
  /اسائنمنٹ/, /ہوم\s?ورک/, /کوئز/, /امتحان/, /جمع\s?(کروا|کرا|کر)/, /آخری\s?تاریخ/, /پروجیکٹ/, /پریزنٹیشن/,
];

const DATE_HINT = [
  /\b(mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?|sun)(day)?\b/i,
  /\b(today|tonight|tomorrow|tmrw|next\s+week|this\s+week|eod|end\s+of\s+(the\s+)?day)\b/i,
  /\b\d{1,2}(st|nd|rd|th)\b/i, /\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i,
  /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i, /\b11:59\b/, /\b(kal|parson|parso)\b/i, /(کل|پرسوں|تاریخ)/,
];

const NOISE = /^(ok(ay)?|k|thanks?|thank\s?you|ty|jazak\s?allah(\s?khair)?|ji|g|yes|no|done|hmm+|sure|alright|👍|🙏|❤️|\.|\?)+[\s!.]*$/i;

const ASSIGNMENT_FILE = /(assign|asgn|hw|home\s?work|lab|task|project|quiz|exercise|problem|sheet|question|paper|q\d)/i;

const DOC_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-powerpoint",
]);

export function prefilterScore(m: PrefilterInput): number {
  const text = (m.text ?? "").trim();
  let score = 0;

  if (m.kind === "document") {
    score += m.mime && DOC_MIME.has(m.mime) ? 2 : 1;
    if (m.fileName && ASSIGNMENT_FILE.test(m.fileName)) score += 3;
  } else if (m.kind === "image") {
    score += text.length > 0 ? 1 : 0;
    if (m.senderRole === "instructor" || m.senderRole === "class_rep" || m.senderIsAdmin) score += 1;
  }

  let strong = 0;
  for (const re of STRONG) {
    if (re.test(text)) strong++;
  }
  if (strong > 0) score += 2 + Math.min(strong, 3);

  if (DATE_HINT.some((re) => re.test(text))) score += 1;

  if (m.senderRole === "instructor" || m.senderRole === "ta" || m.senderRole === "class_rep") score += 2;
  else if (m.senderIsAdmin) score += 1;
  else if (m.senderRole === "student") score -= 1;

  if (m.kind === "text" && (text.length < 4 || NOISE.test(text))) score -= 5;
  return score;
}

export function isCandidate(m: PrefilterInput): boolean {
  return prefilterScore(m) >= CANDIDATE_THRESHOLD;
}
