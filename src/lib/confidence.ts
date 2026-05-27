export type ConfidenceBucket =
  | "verified"
  | "high"
  | "medium"
  | "low"
  | "chart-only";

export interface ConfidenceBadgeSpec {
  bucket: ConfidenceBucket;
  label: string;
  /** Lucide icon name; rendered by the consumer. */
  icon: "ShieldCheck" | "TrendingUp" | "Minus" | "AlertTriangle" | "FileText";
  /** Badge variant token. */
  variant: "fresh" | "default" | "muted" | "stale" | "critical";
}

export function bucketFromScore(score: number): ConfidenceBucket {
  if (score >= 90) return "verified";
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  if (score >= 25) return "low";
  return "chart-only";
}

export function confidenceBadge(score: number): ConfidenceBadgeSpec {
  const bucket = bucketFromScore(score);
  switch (bucket) {
    case "verified":
      return { bucket, label: "Verified", icon: "ShieldCheck", variant: "fresh" };
    case "high":
      return { bucket, label: "High", icon: "TrendingUp", variant: "default" };
    case "medium":
      return { bucket, label: "Medium", icon: "Minus", variant: "muted" };
    case "low":
      return { bucket, label: "Low", icon: "AlertTriangle", variant: "stale" };
    case "chart-only":
      return {
        bucket,
        label: "Chart-only",
        icon: "FileText",
        variant: "critical",
      };
  }
}
