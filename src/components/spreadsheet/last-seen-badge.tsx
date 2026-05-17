"use client";

import { Badge } from "@/components/ui/badge";
import { freshnessBucket, relativeAge } from "@/lib/freshness";
import { Clock } from "lucide-react";

interface Props {
  lastSeenAt: string;
}

export function LastSeenBadge({ lastSeenAt }: Props) {
  const bucket = freshnessBucket(lastSeenAt);
  const variant =
    bucket === "fresh" ? "fresh" : bucket === "stale" ? "stale" : "critical";
  const labelMap = {
    fresh: "Fresh",
    stale: "Aging",
    "stale-critical": "Stale",
  } as const;
  return (
    <Badge
      variant={variant}
      title={`${labelMap[bucket]} · last seen ${new Date(lastSeenAt).toLocaleString()}`}
    >
      <Clock className="size-3" aria-hidden />
      {relativeAge(lastSeenAt)}
    </Badge>
  );
}
