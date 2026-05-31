import { useMemo } from "react";
import { TypeCombobox } from "@/components/app/TypeCombobox";
import { serviceTypes } from "@/lib/mock/data";
import { addServiceType, useStoreVersion } from "@/lib/mock/store";

const DEFAULT_OPTIONS = ["Oil Change", "Inspection", "Registration", "Other"];

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function ServiceTypeCombobox({ value, onChange }: Props) {
  useStoreVersion();
  const options = useMemo(() => {
    const fromStore = serviceTypes.map(t => t.name);
    return fromStore.length > 0 ? fromStore : DEFAULT_OPTIONS;
  }, [serviceTypes.length]);

  return (
    <TypeCombobox
      value={value}
      onChange={onChange}
      options={options}
      onCreate={(name, desc) => addServiceType(name, desc)}
      placeholder="Select service type"
      newLabel="service type"
    />
  );
}
