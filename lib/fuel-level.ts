export const FUEL_LEVEL_LABELS = ["E", "1/4", "1/2", "3/4", "F"] as const;
export const FUEL_LEVEL_MAX = FUEL_LEVEL_LABELS.length - 1;

export const formatFuelLevel = (level: number) => FUEL_LEVEL_LABELS[level] ?? "";
export const isLowFuel = (level: number) => level <= 1;
