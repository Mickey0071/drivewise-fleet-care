import camry from "@/assets/cars/camry.jpg";
import accord from "@/assets/cars/accord.jpg";
import sonata from "@/assets/cars/sonata.jpg";
import k5 from "@/assets/cars/k5.jpg";
import corolla from "@/assets/cars/corolla.jpg";
import altima from "@/assets/cars/altima.jpg";
import civic from "@/assets/cars/civic.jpg";

const map: Record<string, string> = {
  camry, accord, sonata, k5, corolla, altima, civic,
};

export function carImage(model: string): string {
  return map[model.toLowerCase()] ?? camry;
}
