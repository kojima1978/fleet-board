-- 更新日時はアプリが保存時に入れるので、DBの既定値は持たない（schema.prismaの@updatedAtにそろえる）。
ALTER TABLE "FuelThankYouSetting" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ParkingGuidanceSetting" ALTER COLUMN "updatedAt" DROP DEFAULT;
