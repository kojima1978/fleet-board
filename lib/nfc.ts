const HEX_UID = /^[0-9A-F]+$/;

export function normalizeNfcUid(value: string) {
  const trimmed = value.trim().toUpperCase();
  const compact = trimmed.replace(/[\s:-]/g, "");
  return compact.length >= 8 && compact.length % 2 === 0 && HEX_UID.test(compact) ? compact : trimmed;
}

export function sameNfcUid(left: string, right: string) {
  return normalizeNfcUid(left) === normalizeNfcUid(right);
}
