"use client";

import { Badge } from "@/components/ui/badge";
import { confidenceBadge, type ConfidenceBucket } from "@/lib/confidence";
import {
  ShieldCheck,
  TrendingUp,
  Minus,
  AlertTriangle,
  FileText,
} from "lucide-react";

const Icons = {
  ShieldCheck,
  TrendingUp,
  Minus,
  AlertTriangle,
  FileText,
};

const BUCKET_EXPLAINER: Record<ConfidenceBucket, string> = {
  verified: "Seen from multiple sources recently — book with confidence.",
  high: "Recently scraped from the airline — should still be live.",
  medium: "Scraped within the last few hours; may have moved.",
  low: "Scrape is older or had availability noise — sanity-check by clicking through.",
  "chart-only":
    "Estimate from the airline's published award chart — no live availability signal. Real seats not guaranteed.",
};

interface Props {
  score: number;
}

export function ConfidenceBadge({ score }: Props) {
  const spec = confidenceBadge(score);
  const Icon = Icons[spec.icon];
  return (
    <Badge
      variant={spec.variant}
      title={`${spec.label} (${score}/100) — ${BUCKET_EXPLAINER[spec.bucket]}`}
    >
      <Icon className="size-3" aria-hidden />
      {spec.label}
    </Badge>
  );
}
