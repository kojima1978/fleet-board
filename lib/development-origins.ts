import { isIP } from "node:net";

type DevelopmentOriginSettings = {
  [key: string]: string | undefined;
  FLEETFLOW_DEV_BIND_ADDRESS?: string;
  FLEETFLOW_DEV_HOST_NAME?: string;
  FLEETFLOW_DEV_ALLOWED_ORIGINS?: string;
};

export function getDevelopmentOrigins(settings: DevelopmentOriginSettings = process.env): string[] {
  const hosts = [settings.FLEETFLOW_DEV_BIND_ADDRESS, settings.FLEETFLOW_DEV_HOST_NAME, ...(settings.FLEETFLOW_DEV_ALLOWED_ORIGINS ?? "").split(",")];
  return [...new Set(hosts.map((host) => host?.trim().toLowerCase()).filter((host): host is string => {
    if (!host || host === "0.0.0.0" || host === "::") return false;
    // 実際のホストだけを許可し、URL・ポート・ワイルドカードは受け付けない。
    return isIP(host) !== 0 || /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host);
  }))];
}
