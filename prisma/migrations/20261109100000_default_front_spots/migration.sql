-- 手前の区画の初期値を、まだ何も選んでいない区画にだけ一度入れる（prisma/parking-spot-seed.ts の defaultFrontSpotCodes と同じ表）。
-- 区画番号は設定画面で変えられるため、区画は位置で見分ける。表の番号は初期の区画番号。
WITH "geometry"("code", "x", "y") AS (VALUES
  ('01', 269.6 / 9.5, 385.334 / 5.25),
  ('02', 360.6 / 9.5, 385.334 / 5.25),
  ('03', 451.6 / 9.5, 385.334 / 5.25),
  ('04', 542.6 / 9.5, 385.334 / 5.25),
  ('05', 633.6 / 9.5, 385.334 / 5.25),
  ('06', 724.6 / 9.5, 385.334 / 5.25),
  ('07', 815.6 / 9.5, 385.334 / 5.25),
  ('08', 269.6 / 9.5, 304.334 / 5.25),
  ('09', 395.6 / 9.5, 304.334 / 5.25),
  ('10', 521.6 / 9.5, 304.334 / 5.25),
  ('11', 647.6 / 9.5, 304.334 / 5.25),
  ('12', 771.6 / 9.5, 304.334 / 5.25),
  ('13', 269.6 / 9.5, 222.334 / 5.25),
  ('14', 395.6 / 9.5, 222.334 / 5.25),
  ('15', 521.6 / 9.5, 222.334 / 5.25),
  ('16', 647.6 / 9.5, 222.334 / 5.25),
  ('17', 269.6 / 9.5, 141.334 / 5.25),
  ('18', 393.6 / 9.5, 141.334 / 5.25),
  ('19', 521.6 / 9.5, 141.334 / 5.25),
  ('20', 269.6 / 9.5, 16.6 / 5.25),
  ('21', 360.6 / 9.5, 16.6 / 5.25)
), "defaults"("code", "fronts") AS (VALUES
  ('01', ARRAY['08']),
  ('02', ARRAY['08', '09']),
  ('03', ARRAY['08', '09']),
  ('04', ARRAY['08', '09', '10']),
  ('05', ARRAY['08', '09', '10', '11']),
  ('06', ARRAY['08', '09', '10', '11', '12']),
  ('07', ARRAY['08', '09', '10', '11', '12']),
  ('09', ARRAY['08']),
  ('10', ARRAY['08', '09']),
  ('11', ARRAY['08', '09', '10']),
  ('12', ARRAY['08', '09', '10', '11']),
  ('14', ARRAY['13']),
  ('15', ARRAY['13', '14']),
  ('16', ARRAY['13', '14', '15']),
  ('18', ARRAY['17']),
  ('19', ARRAY['17', '18']),
  ('20', ARRAY['17']),
  ('21', ARRAY['17', '18'])
), "located" AS (
  SELECT g."code", s."id" FROM "geometry" g
  JOIN "ParkingSpot" s ON abs(s."x" - g."x"::float8) < 0.01 AND abs(s."y" - g."y"::float8) < 0.01
), "filled" AS (
  SELECT l."id", ARRAY(SELECT f."id" FROM "located" f WHERE f."code" = ANY(d."fronts") ORDER BY f."code") AS "frontIds"
  FROM "located" l JOIN "defaults" d ON d."code" = l."code"
)
UPDATE "ParkingSpot" s
SET "frontSpotIds" = filled."frontIds", "version" = s."version" + 1
FROM "filled" filled
WHERE s."id" = filled."id" AND cardinality(s."frontSpotIds") = 0 AND cardinality(filled."frontIds") > 0;
