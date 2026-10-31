import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";
import { parkingSpotGeometry, syncParkingSpots } from "./parking-spot-seed";
import { seedGuidanceDefaults } from "./guidance-defaults";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  await syncParkingSpots(prisma);
  await seedGuidanceDefaults(prisma);
  console.log(`Production parking spots initialized: ${parkingSpotGeometry.length}`);
}

main().finally(() => prisma.$disconnect());
