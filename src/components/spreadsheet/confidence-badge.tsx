"use client";

import { Badge } from "@/components/ui/badge";
import { confidenceBadge } from "@/lib/confidence";
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

interface Props {
  score: number;
}

export function ConfidenceBadge({ score }: Props) {
  const spec = confidenceBadge(score);
  const Icon = Icons[spec.icon];
  return (
    <Badge
      variant={spec.variant}
      title={`Confidence ${score}/100 · ${spec.label}`}
    >
      <Icon className="size-3" aria-hidden />
      {spec.label}
    </Badge>
  );
}
