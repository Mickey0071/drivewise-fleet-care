export interface VehicleLabelInput {
  make?: string | null;
  model?: string | null;
  year?: number | string | null;
  plate?: string | null;
}

export function formatVehiclePickerLabel(vehicle: VehicleLabelInput): string {
  const type = [vehicle.make, vehicle.model]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");
  return [type, vehicle.year, vehicle.plate]
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
    .map((value) => String(value).trim().toUpperCase())
    .join(" · ");
}

export function compareVehiclePickerOrder(a: VehicleLabelInput, b: VehicleLabelInput): number {
  const options: Intl.CollatorOptions = { sensitivity: "base", numeric: true };
  return (
    String(a.make ?? "").localeCompare(String(b.make ?? ""), "en", options) ||
    String(a.model ?? "").localeCompare(String(b.model ?? ""), "en", options) ||
    Number(a.year ?? 0) - Number(b.year ?? 0) ||
    String(a.plate ?? "").localeCompare(String(b.plate ?? ""), "en", options)
  );
}

export function sortVehiclePickerOptions<T extends VehicleLabelInput>(vehicles: readonly T[]): T[] {
  return [...vehicles].sort(compareVehiclePickerOrder);
}