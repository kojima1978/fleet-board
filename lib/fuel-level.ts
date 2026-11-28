export const FUEL_LEVEL_LABELS = ["E", "1/4", "1/2", "3/4", "F"] as const;
export const FUEL_LEVEL_MAX = FUEL_LEVEL_LABELS.length - 1;
export const FUEL_START_REMINDER_MAX_LEVEL = 2;
export const FUEL_RETURN_REMINDER_MAX_LEVEL = 1;

export const formatFuelLevel = (level: number) => FUEL_LEVEL_LABELS[level] ?? "";
export const isLowFuel = (level: number) => level <= 1;
// 残量の色分け。Eは赤、1/4は黄色、1/2以上は通常の色にする。
export type FuelTone = "empty" | "low" | "normal";
export const fuelTone = (level: number): FuelTone => level <= 0 ? "empty" : isLowFuel(level) ? "low" : "normal";
export const needsStartFuelReminder = (level: number | null) => level !== null && level <= FUEL_START_REMINDER_MAX_LEVEL;
export const needsReturnFuelReminder = (level: number | null) => level !== null && level <= FUEL_RETURN_REMINDER_MAX_LEVEL;
