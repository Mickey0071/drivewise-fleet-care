import { useMemo } from "react";
import { TypeCombobox } from "@/components/app/TypeCombobox";
import { repairTypes } from "@/lib/mock/data";
import { addRepairType, useStoreVersion } from "@/lib/mock/store";

const DEFAULT_OPTIONS = [
  "Tie Rods", "Control Arm", "Engine", "Transmission", "Brakes",
  "Suspension", "Alternator", "Starter", "Compressor", "Axle",
  "Differential", "Other",
];

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function RepairTypeCombobox({ value, onChange }: Props) {
  useStoreVersion();
  const options = useMemo(() => {
    const fromStore = repairTypes.map(t => t.name);
    return fromStore.length > 0 ? fromStore : DEFAULT_OPTIONS;
  }, [repairTypes.length]);

  return (
    <TypeCombobox
      value={value}
      onChange={onChange}
      options={options}
      onCreate={(name, desc) => addRepairType(name, desc)}
      placeholder="Select repair item"
      newLabel="repair type"
    />
  );
}
