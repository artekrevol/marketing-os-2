import { z } from "zod";
import {
  RECOVERY_INITIATIVE_STATUSES,
  RECOVERY_INITIATIVE_TYPES,
} from "@workspace/db";

/** Mirror of the SQL CHECK on `recovery_initiatives.type`. */
export const RecoveryInitiativeTypeSchema = z.enum(
  RECOVERY_INITIATIVE_TYPES as unknown as [string, ...string[]],
);
export type RecoveryInitiativeTypeInput = z.infer<
  typeof RecoveryInitiativeTypeSchema
>;

/** Mirror of the SQL CHECK on `recovery_initiatives.status`. */
export const RecoveryInitiativeStatusSchema = z.enum(
  RECOVERY_INITIATIVE_STATUSES as unknown as [string, ...string[]],
);
export type RecoveryInitiativeStatusInput = z.infer<
  typeof RecoveryInitiativeStatusSchema
>;

/** Input to `lockBaseline`. Per amendments §D.2, GSC/GA4 fields write NULL. */
export const LockBaselineInputSchema = z.object({
  brandId: z.string().uuid(),
  baselineDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "baselineDate must be ISO date YYYY-MM-DD"),
  lockedBy: z.string().uuid(),
  notes: z.string().optional(),
  recoveryThresholdPct: z.number().positive().optional(),
  recoveryConsecutiveDays: z.number().int().positive().optional(),
});
export type LockBaselineInput = z.infer<typeof LockBaselineInputSchema>;

/** Input to `createInitiative`. */
export const CreateInitiativeInputSchema = z.object({
  brandId: z.string().uuid(),
  actorId: z.string().uuid(),
  name: z.string().min(1),
  type: RecoveryInitiativeTypeSchema,
  description: z.string().optional(),
  expectedImpactPct: z.number().optional(),
  expectedImpactClicks: z.number().int().optional(),
  startedAt: z.coerce.date(),
});
export type CreateInitiativeInput = z.infer<typeof CreateInitiativeInputSchema>;

/** Input to `updateInitiative`. All non-id/scope fields optional. */
export const UpdateInitiativeInputSchema = z.object({
  brandId: z.string().uuid(),
  actorId: z.string().uuid(),
  initiativeId: z.string().uuid(),
  name: z.string().min(1).optional(),
  type: RecoveryInitiativeTypeSchema.optional(),
  description: z.string().nullable().optional(),
  expectedImpactPct: z.number().nullable().optional(),
  expectedImpactClicks: z.number().int().nullable().optional(),
  startedAt: z.coerce.date().optional(),
  // `completed` is intentionally not accepted here — completion has
  // side effects (timestamp + delayed BullMQ impact job) that only
  // `completeInitiative` performs. Allow transitions among the other
  // statuses (e.g. paused/abandoned).
  status: RecoveryInitiativeStatusSchema.exclude(["completed"]).optional(),
});
export type UpdateInitiativeInput = z.infer<typeof UpdateInitiativeInputSchema>;

/** Input to `completeInitiative`. */
export const CompleteInitiativeInputSchema = z.object({
  brandId: z.string().uuid(),
  actorId: z.string().uuid(),
  initiativeId: z.string().uuid(),
});
export type CompleteInitiativeInput = z.infer<
  typeof CompleteInitiativeInputSchema
>;
