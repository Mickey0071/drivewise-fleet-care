export const CHECKLIST_SECTIONS = [
  { title: 'Before Starting Car', items: [
    { key: 'oil_level', label: 'Check oil level before starting engine' },
    { key: 'spare_key', label: 'Spare key present and accounted for' },
    { key: 'inspection_sticker', label: 'Inspection sticker — valid and not expired' },
  ]},
  { title: 'Exterior', items: [
    { key: 'four_corners', label: 'Inspected all four corners' },
    { key: 'tires', label: 'All 4 tires — no flats, bulges, or extreme wear' },
    { key: 'lights', label: 'All lights working — headlights, taillights, signals' },
    { key: 'windshield', label: 'Windshield — no new cracks' },
    { key: 'wipers', label: 'Windshield wipers functional' },
    { key: 'windows', label: 'All windows intact and functional' },
    { key: 'seatbelts', label: 'All seatbelts latch and retract properly' },
  ]},
  { title: 'Interior', items: [
    { key: 'no_trash', label: 'No trash or personal items from renter' },
    { key: 'no_odors', label: 'No odors — smoke, food, or other' },
    { key: 'floor_mats', label: 'Floor mats present and not near pedals' },
    { key: 'glovebox_docs', label: 'Insurance card and registration in glovebox' },
    { key: 'spare_tire_kit', label: 'Spare tire, jack, and lug wrench in trunk' },
    { key: 'ac', label: 'Air conditioner working properly' },
    { key: 'radio', label: 'Radio / infotainment functional' },
  ]},
  { title: 'Test Drive', items: [
    { key: 'test_drive_completed', label: 'Test drive completed' },
    { key: 'brakes', label: 'Brakes firm — no grinding, no pulling' },
    { key: 'dash_warnings', label: 'No warning lights on dashboard' },
    { key: 'steering', label: 'Steering tracks straight, no clunking' },
    { key: 'transmission', label: 'Transmission shifts smoothly' },
    { key: 'no_clunking', label: 'No loud clunking over bumps' },
  ]},
] as const;

export const JOB_TYPE_LABELS: Record<string, string> = {
  vehicle_return: '🔑 Vehicle Return',
  repossession: '🚨 Repossession',
  new_acquisition: '🏷️ New Acquisition',
  mechanic_run: '🔧 Mechanic Run',
  dmv_reg: '📋 DMV / Reg',
  inspection: '✅ Inspection',
};

export const FUEL_LEVEL_LABELS: Record<string, string> = {
  full: 'Full',
  three_quarter: '3/4',
  half: '1/2',
  quarter: '1/4',
  empty: 'Empty / Very Low',
};
