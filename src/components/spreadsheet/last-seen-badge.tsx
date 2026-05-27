"use client";

import { Badge } from "@/components/ui/badge";
import { freshnessBucket, relativeAge } from "@/lib/freshness";
import { Clock } from "lucide-react";

interface Props {
  lastSeenAt: string;
}

const LABEL_MAP = {
  fresh: "Fresh",
  stale: "Aging",
  "stale-critical": "Stale",
} as const;

const EXPLAINER_MAP = {
  fresh: "Scraped in the last 5 minutes",
  stale: "Scraped between 5 minutes and 1 hour ago — may have moved",
  "stale-critical": "Scraped over 1 hour ago — re-verify before booking",
} as const;

export function LastSeenBadge({ lastSeenAt }: Props) {
  const bucket = freshnessBucket(lastSeenAt);
  const variant =
    bucket === "fresh" ? "fresh" : bucket === "stale" ? "stale" : "critical";
  return (
    <Badge
      variant={variant}
      title={`${LABEL_MAP[bucket]} — ${EXPLAINER_MAP[bucket]}. Last seen ${new Date(lastSeenAt).toLocaleString()}.`}
    >
      <Clock className="size-3" aria-hidden />
      {relativeAge(lastSeenAt)}
    </Badge>
  );
}
