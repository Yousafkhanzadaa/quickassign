// Parses what students type in their own WhatsApp chat ("Message yourself").
// Commands arrive either as a reply to one of our notices or prefixed with "qa".

export type Command =
  | { type: "solve"; taskNo?: number }
  | { type: "skip"; taskNo?: number }
  | { type: "status" }
  | { type: "help" }
  | { type: "unknown" };

const SOLVE = /^(solve|yes|y|haan|han|ha|ji|go|ok solve|solve it|kar do|krdo|kardo|bana do|banado)$/;
const SKIP = /^(skip|no|n|nahi|nhi|nahin|ignore|cancel|chor do|chordo)$/;

export function parseCommand(raw: string): Command {
  let t = raw.trim().toLowerCase();
  t = t.replace(/^\/?qa[:\s]*/, "").trim();
  t = t.replace(/[.!?،۔]+$/u, "").trim();

  const numbered = /^(solve|skip)\s*#?(\d{1,5})$/.exec(t);
  if (numbered) {
    const taskNo = Number(numbered[2]);
    return numbered[1] === "solve" ? { type: "solve", taskNo } : { type: "skip", taskNo };
  }
  if (SOLVE.test(t)) return { type: "solve" };
  if (SKIP.test(t)) return { type: "skip" };
  if (/^(status|list|tasks|pending)$/.test(t)) return { type: "status" };
  if (t === "" || /^(help|commands|\?)$/.test(t)) return { type: "help" };
  return { type: "unknown" };
}
