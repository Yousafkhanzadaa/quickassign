import type { MetadataRoute } from "next";

// Only the public pages are worth indexing; app pages also send noindex.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard", "/whatsapp", "/groups", "/courses", "/tasks", "/settings", "/billing", "/onboarding", "/sign-in", "/sign-up", "/two-factor"],
    },
  };
}
