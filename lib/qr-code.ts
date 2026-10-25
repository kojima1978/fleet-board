import { randomBytes } from "node:crypto";

export type QrOwnerKind = "employee" | "vehicle";

const PREFIX = "FLEETFLOW";
const TOKEN_PATTERN = /^[A-Z0-9_-]{16,64}$/;

export function createQrToken() {
  return randomBytes(15).toString("base64url").toUpperCase();
}

export function qrPayload(kind: QrOwnerKind, token: string) {
  return `${PREFIX}:${kind === "employee" ? "E" : "V"}:${token}`;
}

export function parseQrPayload(value: string): { kind: QrOwnerKind; token: string } | null {
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  const match = /^FLEETFLOW:(E|V):([A-Z0-9_-]{16,64})$/.exec(normalized);
  if (!match || !TOKEN_PATTERN.test(match[2])) return null;
  return { kind: match[1] === "E" ? "employee" : "vehicle", token: match[2] };
}
