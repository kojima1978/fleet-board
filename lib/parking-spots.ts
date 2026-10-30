export const PARKING_SPOT_ROLES = ["REGULAR", "TEMPORARY", "CUSTOMER", "DEDICATED", "HOLDING"] as const;
export type ParkingSpotRole = (typeof PARKING_SPOT_ROLES)[number];

export const SPOT_ROLE_LABELS: Record<ParkingSpotRole, string> = { REGULAR: "通常", TEMPORARY: "一時", CUSTOMER: "お客様用", DEDICATED: "専用", HOLDING: "仮置き" };
export const SPOT_ROLE_DESCRIPTIONS: Record<ParkingSpotRole, string> = {
  REGULAR: "社用車の通常の駐車位置",
  TEMPORARY: "通常区画ではないが、一時的な返却先として使える",
  CUSTOMER: "お客様用。社用車はできるだけ止めない",
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

// お客様用の区画。社用車も止められるが、できるだけ止めないよう案内する。
export const isCustomerSpot = (spot: Pick<SpotRoleInfo, "role">) => spot.role === "CUSTOMER";

// お客様用の区画の代わりに案内する、空いている通常区画（その車の専用区画を含む）。
export const freeRegularSpots = <T extends Pick<SpotRoleInfo, "code" | "role" | "dedicatedVehicleId"> & { enabled: boolean; vehicle?: unknown }>(spots: T[], vehicle: { id: string } | null) =>
  spots.filter((spot) => spot.enabled && !spot.vehicle && (spot.role === "REGULAR" || (spot.role === "DEDICATED" && !!vehicle && spot.dedicatedVehicleId === vehicle.id)));

// 手前の区画に駐車中の区画。中央の道路から出し入れするとき、先にその車を動かす必要がある。
export const blockingFrontSpots = <T extends { id: string; vehicle?: { id: string } | null }>(spot: { frontSpotIds?: string[] } | null | undefined, spots: T[], vehicleId?: string | null) =>
  spot?.frontSpotIds?.length ? spots.filter((item) => spot.frontSpotIds!.includes(item.id) && !!item.vehicle && item.vehicle.id !== vehicleId) : [];
