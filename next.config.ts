import type { NextConfig } from "next";
import { getDevelopmentOrigins } from "./lib/development-origins";

const development = process.env.NODE_ENV === "development";
const scriptSources = development ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";
const allowedDevOrigins = getDevelopmentOrigins();

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // LANアクセス時にも開発用リソースとHMRを許可する。許可先は公開IPとPC名だけに限定する。
  allowedDevOrigins,
  // Docker Desktop のバインドマウントは一時的に EIO を返すことがあり、Turbopack の
  // 開発用ディスクキャッシュがその失敗を記録して再起動後も 500 を返し続ける。
  // キャッシュはメモリ上だけにして、一時的な失敗が残らないようにする。
  experimental: {
    turbopackFileSystemCacheForDev: false,
    agentUpgrade: "security",
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: `default-src 'self'; script-src ${scriptSources}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:17831 http://localhost:17831; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'` },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ],
    }];
  },
};

export default nextConfig;
