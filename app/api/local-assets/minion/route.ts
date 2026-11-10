import { stat } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

const MODEL_PATH = join(process.cwd(), "public", "local-assets", "minions", "minion.glb");
const MAX_MODEL_BYTES = 25 * 1024 * 1024;

export async function HEAD() {
  let available = false;
  let size = 0;
  try {
    const file = await stat(MODEL_PATH);
    available = file.isFile() && file.size > 0 && file.size <= MAX_MODEL_BYTES;
    size = file.size;
  } catch {
    // ローカル専用モデルは任意。未配置を障害として扱わない。
  }

  return new NextResponse(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      "X-FleetFlow-Model-Available": available ? "1" : "0",
      "X-FleetFlow-Model-Size": String(size),
    },
  });
}
