/** Accepts +92 300 1234567, 923001234567 or the local 03001234567 form. */
export function normalizePkPhone(raw: string): string | null {
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (/^03\d{9}$/.test(d)) d = `92${d.slice(1)}`; // Pakistani mobile in local format
  return /^[1-9]\d{9,14}$/.test(d) ? d : null;
}
