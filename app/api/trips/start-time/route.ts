import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/prisma/generated/client";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1));
  const where: Prisma.TripWhereInput = { status: { in: ["IN_USE", "COMPLETED"] }, actualStart: { not: null },
      ...(q ? { OR: [{ vehicle: { name: { contains: q, mode: "insensitive" as const } } }, { employee: { name: { contains: q, mode: "insensitive" as const } } }] } : {}),
    };
  const [records, total] = await Promise.all([prisma.trip.findMany({
    where, orderBy: [{ actualStart: "desc" }, { id: "asc" }], take: 50, skip: (page - 1) * 50,
    select: { id: true, version: true, status: true, plannedStart: true, plannedEnd: true, actualStart: true, actualEnd: true, vehicle: { select: { name: true } }, employee: { select: { name: true } } },
  }), prisma.trip.count({ where })]);
  return NextResponse.json({ records, pages: Math.max(1, Math.ceil(total / 50)) }, { headers: { "Cache-Control": "no-store" } });
}
