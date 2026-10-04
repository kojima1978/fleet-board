import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "fleetflow_admin";
const SESSION_HOURS = 8;

const secret = () => process.env.FLEETFLOW_SESSION_SECRET || "fleetflow-local-development-secret";
const signature = (expiresAt: string) => createHmac("sha256", secret()).update(expiresAt).digest("hex");

export function createAdminToken(now = Date.now()) {
  const expiresAt = String(now + SESSION_HOURS * 60 * 60_000);
  return `${expiresAt}.${signature(expiresAt)}`;
}

export function verifyAdminToken(token?: string | null, now = Date.now()) {
  if (!token) return false;
  const [expiresAt, provided] = token.split(".");
  if (!expiresAt || !provided || Number(expiresAt) <= now) return false;
  const expected = signature(expiresAt);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export function verifyAdminPin(pin: string) {
  const configured = process.env.FLEETFLOW_ADMIN_PIN || "2468";
  if (pin.length !== configured.length) return false;
  return timingSafeEqual(Buffer.from(pin), Buffer.from(configured));
}

export function adminTokenFromRequest(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length + 1) ?? null;
}
