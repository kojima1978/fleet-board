import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";
import { parkingSpotGeometry } from "./parking-spot-seed";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  for (const geometry of parkingSpotGeometry) {
    await prisma.parkingSpot.upsert({
      where: { code: geometry.code },
      update: geometry,
      create: geometry,
    });
  }
  console.log(`Production parking spots initialized: ${parkingSpotGeometry.length}`);
}

main().finally(() => prisma.$disconnect());
