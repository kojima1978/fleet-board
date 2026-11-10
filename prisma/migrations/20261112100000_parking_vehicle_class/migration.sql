CREATE TYPE "ParkingVehicleClass" AS ENUM ('ANY', 'STANDARD', 'KEI');

ALTER TABLE "ParkingSpot" ADD COLUMN "vehicleClass" "ParkingVehicleClass" NOT NULL DEFAULT 'ANY';
