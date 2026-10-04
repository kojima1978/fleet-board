export const TEMPORARY_SPOT_CODES = new Set(["08", "13", "17", "18"]);
export const HOLDING_SPOT_CODES = new Set(["22", "23"]);
export const CUSTOMER_SPOT_CODES = new Set(["01", "02", "20", "24"]);
export const SAKURA_SPOT_CODE = "19";

export const formatSpotLabel = (code: string) =>
  code === SAKURA_SPOT_CODE
    ? `区画 ${code}（サクラ専用）`
    : CUSTOMER_SPOT_CODES.has(code)
      ? `区画 ${code}（お客様用）`
      : HOLDING_SPOT_CODES.has(code)
        ? `仮置き ${code}（実在区画なし）`
        : TEMPORARY_SPOT_CODES.has(code)
          ? `区画 ${code}（一時）`
          : `区画 ${code}`;
