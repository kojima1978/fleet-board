ALTER TABLE "Department"
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- これまでの名前順を、そのまま最初の並び順にする。
UPDATE "Department" AS department
SET "sortOrder" = ordered."position"
FROM (SELECT "id", ROW_NUMBER() OVER (ORDER BY "name") AS "position" FROM "Department") AS ordered
WHERE department."id" = ordered."id";
