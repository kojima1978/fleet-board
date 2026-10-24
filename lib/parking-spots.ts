export const PARKING_SPOT_ROLES = ["REGULAR", "TEMPORARY", "CUSTOMER", "DEDICATED", "HOLDING"] as const;
export type ParkingSpotRole = (typeof PARKING_SPOT_ROLES)[number];

export const SPOT_ROLE_LABELS: Record<ParkingSpotRole, string> = { REGULAR: "通常", TEMPORARY: "一時", CUSTOMER: "お客様用", DEDICATED: "専用", HOLDING: "仮置き" };
export const SPOT_ROLE_DESCRIPTIONS: Record<ParkingSpotRole, string> = {
  REGULAR: "社用車の通常の駐車位置",
  TEMPORARY: "通常区画ではないが、一時的な返却先として使える",
  CUSTOMER: "お客様用だが、社用車も返却できる",
  DEDICATED: "指定した1台だけが駐車できる",
  HOLDING: "実在しない区画。駐車場所を確定できない場合だけ使う",
};

type SpotRoleInfo = { code: string; role: ParkingSpotRole; dedicatedVehicleId: string | null; dedicatedVehicleName: string | null; label: string | null };

export const SPOT_LABEL_MAX_LENGTH = 10;

// 表示名を設定していない区画で使う、用途から決まる名前。通常区画は何も付けない。
export const defaultSpotTag = (spot: Omit<SpotRoleInfo, "label">) =>
  spot.role === "DEDICATED" ? `${spot.dedicatedVehicleName ?? "車両未設定"}専用` : spot.role === "REGULAR" ? "" : SPOT_ROLE_LABELS[spot.role];

// 地図の区画番号の横に添える短い名前。設定画面で変えた表示名を優先する。
export const spotRoleTag = (spot: SpotRoleInfo) => spot.label ?? defaultSpotTag(spot);

export const formatSpotLabel = (spot: SpotRoleInfo) =>
  spot.role === "HOLDING" && !spot.label
    ? `仮置き ${spot.code}（実在区画なし）`
    : !spotRoleTag(spot)
      ? `区画 ${spot.code}`
      : `区画 ${spot.code}（${spotRoleTag(spot)}）`;

export const isDashedSpot = (spot: Pick<SpotRoleInfo, "role">) => spot.role === "HOLDING" || spot.role === "TEMPORARY";

// 専用区画には指定した車両だけを置ける。
export const canUseSpot = (vehicle: { id: string }, spot: Pick<SpotRoleInfo, "role" | "dedicatedVehicleId">) =>
  spot.role !== "DEDICATED" || spot.dedicatedVehicleId === vehicle.id;
