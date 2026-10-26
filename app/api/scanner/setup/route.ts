import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { SCANNER_SETUP_PATH, scannerSetupFilename } from "@/lib/scanner-setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const metadata = await stat(SCANNER_SETUP_PATH);
    const origin = new URL(request.nextUrl.protocol + "//" + (request.headers.get("host") ?? request.nextUrl.host)).origin;
    const stream = Readable.toWeb(createReadStream(SCANNER_SETUP_PATH)) as ReadableStream<Uint8Array>;
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${scannerSetupFilename(origin)}"`,
        "Content-Length": String(metadata.size),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "セットアップの準備ができていません。管理者にFleetFlowのイメージ再ビルドを依頼してください。" }, { status: 503 });
  }
}
