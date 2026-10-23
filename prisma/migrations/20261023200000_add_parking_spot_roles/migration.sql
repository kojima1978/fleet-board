CREATE TYPE "ParkingSpotRole" AS ENUM ('REGULAR', 'TEMPORARY', 'CUSTOMER', 'DEDICATED', 'HOLDING');

ALTER TABLE "ParkingSpot"
ADD COLUMN "role" "ParkingSpotRole" NOT NULL DEFAULT 'REGULAR',
ADD COLUMN "dedicatedVehicleId" TEXT;

-- これまでコードで固定していた区画の役割を、そのままデータへ移す。
UPDATE "ParkingSpot" SET "role" = 'TEMPORARY' WHERE "code" IN ('08', '13', '17', '18');
UPDATE "ParkingSpot" SET "role" = 'CUSTOMER' WHERE "code" IN ('01', '02', '20', '24');
UPDATE "ParkingSpot" SET "role" = 'HOLDING' WHERE "code" IN ('22', '23');
UPDATE "ParkingSpot" AS spot
SET "role" = 'DEDICATED', "dedicatedVehicleId" = dedicated."id"
FROM (
  SELECT v."id"
  FROM "Vehicle" v
  JOIN "VehicleNumber" n ON n."id" = v."vehicleNumberId"
  WHERE n."code" = 'C07'
  ORDER BY v."active" DESC, v."createdAt" DESC
  LIMIT 1
) AS dedicated
WHERE spot."code" = '19';
