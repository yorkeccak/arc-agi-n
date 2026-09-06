import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: "https://arc-agi-n.com", changeFrequency: "weekly", priority: 1 }];
}
