ALTER TABLE "Vehicle"
ADD COLUMN "fuelLevel" INTEGER;

ALTER TABLE "Trip"
ADD COLUMN "returnFuelLevel" INTEGER,
ADD COLUMN "previousFuelLevel" INTEGER;
