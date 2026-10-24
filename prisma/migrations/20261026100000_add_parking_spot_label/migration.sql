-- 配置図に出す区画の表示名。空のときは用途から自動で決める。
ALTER TABLE "ParkingSpot" ADD COLUMN "label" TEXT;
