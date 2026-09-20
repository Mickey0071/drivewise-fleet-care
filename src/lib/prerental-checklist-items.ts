// The 8-category pre-rental inspection checklist template.
export const PRERENTAL_CHECKLIST: { category: string; items: string[] }[] = [
  {
    category: "Fluids & Filters",
    items: [
      "Engine oil level & condition",
      "Oil filter condition",
      "Coolant level & condition",
      "Brake fluid level & condition",
      "Power steering fluid level",
      "Windshield washer fluid level",
      "Transmission fluid (if accessible)",
      "Differential fluid (if applicable)",
    ],
  },
  {
    category: "Tires & Wheels",
    items: [
      'Tire tread depth (min 2/32")',
      "Tire pressure (check all 4)",
      "Tire condition & wear pattern",
      "Spare tire condition & pressure",
      "Wheel alignment (visual check)",
      "Lug nuts/bolts tight",
      "No bulges or sidewall damage",
    ],
  },
  {
    category: "Brakes",
    items: [
      "Brake pad wear (visual)",
      "Brake disc condition",
      "Brake fluid color & level",
      "Brake responsiveness (test drive)",
      "Brake warning lights",
      "Parking brake functionality",
    ],
  },
  {
    category: "Lights & Visibility",
    items: [
      "Headlights (low & high beam)",
      "Fog lights (if equipped)",
      "Brake lights",
      "Reverse lights",
      "Turn signals (front & rear)",
      "Hazard lights",
      "Interior lights",
      "Windshield wipers & fluid",
      "All windows clean & clear",
    ],
  },
  {
    category: "Engine & Mechanical",
    items: [
      "Engine starts smoothly",
      "Engine runs without knocking",
      "No visible leaks under vehicle",
      "Battery terminals clean & tight",
      "Alternator charging properly",
      "Air filter condition",
      "Cabin air filter condition",
      "Exhaust system intact",
      "Engine noise assessment",
    ],
  },
  {
    category: "Suspension & Steering",
    items: [
      "Steering wheel play (minimal)",
      "Power steering functionality",
      "Suspension components secure",
      "No excessive bounce/sag",
      "Shocks/struts condition",
      "Ball joints & tie rods",
      "No clunking noises",
    ],
  },
  {
    category: "Interior Condition",
    items: [
      "Seats & upholstery (tears, stains)",
      "Door locks & windows functional",
      "Dashboard & instrument lights",
      "Climate control functioning",
      "Radio & audio system",
      "Odometer reading correct",
      "Floor mats intact",
      "Trunk/hatch opens & closes",
    ],
  },
  {
    category: "Exterior & Safety",
    items: [
      "All doors open & close smoothly",
      "Paint condition & chips",
      "Windows intact (no cracks)",
      "Mirror condition & adjustment",
      "Bumpers & trim secure",
      "Body panels aligned",
      "Door handles functional",
      "Seatbelts all functional",
      "Airbag warning light off",
    ],
  },
];

export const CHECKLIST_CATEGORIES = PRERENTAL_CHECKLIST.map((c) => c.category);

export const TRACKER_TYPES: { value: string; label: string; monthsUntilNext?: number }[] = [
  { value: "oil_change", label: "Oil Change", monthsUntilNext: 4 },
  { value: "tire_replacement", label: "Tire Replacement", monthsUntilNext: 24 },
  { value: "brake_service", label: "Brake Service", monthsUntilNext: 12 },
  { value: "battery", label: "Battery", monthsUntilNext: 36 },
  { value: "filter_replacement", label: "Filter Replacement", monthsUntilNext: 12 },
  { value: "suspension_service", label: "Suspension Service" },
  { value: "light_repair", label: "Light Repair" },
  { value: "other", label: "Other" },
];

export function trackerTypeLabel(v: string): string {
  return TRACKER_TYPES.find((t) => t.value === v)?.label ?? v;
}

export const CHECKLIST_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  failed: "Failed",
};
