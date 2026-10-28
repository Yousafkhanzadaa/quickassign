import "server-only";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export type UploadKind = "pdf" | "docx" | "pptx" | "jpeg" | "png" | "text";

const MIME: Record<UploadKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  jpeg: "image/jpeg",
  png: "image/png",
  text: "text/plain",
};

/** Identifies a file by its bytes; the browser-supplied type and name are ignored. */
export function sniffUpload(buf: Buffer): { kind: UploadKind; mime: string } | null {
  let kind: UploadKind | null = null;
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") kind = "pdf";
  else if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) kind = "jpeg";
  else if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) kind = "png";
  else if (buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    // OOXML: look for the main part names in the zip directory.
    const s = buf.toString("latin1");
    if (s.includes("word/document.xml")) kind = "docx";
    else if (s.includes("ppt/slides/")) kind = "pptx";
  } else if (!buf.includes(0) && Buffer.from(buf.toString("utf8"), "utf8").equals(buf)) kind = "text";
  return kind ? { kind, mime: MIME[kind] } : null;
}

/** Display-safe base name: no paths or control characters. */
export function cleanFileName(name: string, fallback: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 150);
  return cleaned || fallback;
}

/** RFC 5987 Content-Disposition value that is safe for any file name. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
