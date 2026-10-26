export const SCANNER_SETUP_PATH = "/opt/fleetflow/scanner-setup/FleetFlow-Setup.exe";

export function scannerSetupFilename(origin: string) {
  const url = new URL(origin);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid application origin");
  return `FleetFlow-Setup-${Buffer.from(url.origin).toString("base64url")}.exe`;
}
