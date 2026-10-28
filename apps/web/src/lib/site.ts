import "server-only";
import { env } from "./env";

export interface SiteInfo {
  legalName: string;
  contactEmail?: string;
  contactAddress?: string;
  repoUrl?: string;
  freeCredits: number;
}

/** Operator details shown on public pages (footer, legal pages). */
export function site(): SiteInfo {
  const e = env();
  return {
    legalName: e.LEGAL_NAME,
    contactEmail: e.CONTACT_EMAIL,
    contactAddress: e.CONTACT_ADDRESS,
    repoUrl: e.REPO_URL?.replace(/\/+$/, ""),
    freeCredits: e.FREE_SIGNUP_CREDITS,
  };
}
