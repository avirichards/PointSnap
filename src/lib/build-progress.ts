import { z } from "zod";
export const progressState = z.enum([
  "investigating",
  "integrating",
  "flight_feed",
  "calendar",
  "blocked",
  "auth_required",
  "unverified",
  "retired",
]);
export const progressSchema = z.object({
  updatedAt: z.string(),
  active: z.boolean(),
  focus: z.string(),
  airlines: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      code: z.string(),
      state: progressState,
      summary: z.string(),
      next: z.string(),
      updatedAt: z.string(),
      source: z.string().url().optional(),
    }),
  ),
  events: z.array(
    z.object({
      id: z.string(),
      at: z.string(),
      airline: z.string(),
      message: z.string(),
      kind: z.enum(["finding", "verified", "fix", "blocked", "update"]),
    }),
  ),
});
export type BuildProgress = z.infer<typeof progressSchema>;
