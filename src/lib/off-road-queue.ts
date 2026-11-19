import type { Maintenance } from "@/lib/mock/data";

/** Presentation-only: diagnosis completion does not close a repair or free the car. */
export function needsOffRoadDiagnosis(
  repair: Pick<Maintenance, "id" | "status" | "dateCompleted" | "diagnosisTitle">,
  submittedDiagnosisIds: ReadonlySet<string>,
): boolean {
  if (!repair.status || repair.status === "complete" || repair.dateCompleted) return false;
  if (submittedDiagnosisIds.has(repair.id) || repair.diagnosisTitle?.trim()) return false;
  return repair.status === "reported" || repair.status === "diagnosing";
}