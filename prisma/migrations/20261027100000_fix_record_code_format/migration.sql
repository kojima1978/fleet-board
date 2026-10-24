-- 社員番号・車両番号を英字1文字＋数字3桁へそろえ、DBでもこの形式以外を保存できないようにする。
-- 0. どの社員・車両にも使われていない番号は消す（番号を変えたときに残った古い番号など）。
-- 1. 形式どおりの番号はそのまま残す。
-- 2. C01・e7・ｃ０１などは、全角を半角・小文字を大文字にして3桁へ埋める（C001、E007）。
-- 3. 2で埋めた番号がすでにある場合や、変換できない番号は、同じ英字（英字がなければ社員E・車両C）の空いている最小の番号にする。
--    2をすべて終えてから3を行い、3桁へ埋めるだけで済む番号を優先する。
-- 4. 初期データの仮のNFC UID（NFC-C02など）は、割り当て先の番号に合わせる（NFC-C002）。
-- lib/record-codes.ts・lib/json-backup.ts と同じ規則にする。何度実行しても結果は変わらない。
DELETE FROM "EmployeeNumber" n WHERE NOT EXISTS (SELECT 1 FROM "Employee" e WHERE e."employeeNumberId" = n.id);
DELETE FROM "VehicleNumber" n WHERE NOT EXISTS (SELECT 1 FROM "Vehicle" v WHERE v."vehicleNumberId" = n.id);

DO $$
DECLARE
  target record;
  item record;
  normalized text;
  candidate text;
  letter text;
  taken boolean;
BEGIN
  FOR target IN SELECT * FROM (VALUES ('EmployeeNumber', 'E'), ('VehicleNumber', 'C')) AS t(tbl, fallback) LOOP
  FOR pass IN 1..2 LOOP
    FOR item IN EXECUTE format('SELECT id, code FROM %I WHERE code !~ ''^[A-Z][0-9]{3}$'' ORDER BY code COLLATE "C", id', target.tbl) LOOP
      normalized := upper(btrim(normalize(item.code, NFKC)));
      candidate := NULL;
      IF normalized ~ '^[A-Z][0-9]{1,3}$' THEN
        candidate := left(normalized, 1) || lpad(substr(normalized, 2), 3, '0');
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE code = $1)', target.tbl) INTO taken USING candidate;
        IF taken THEN candidate := NULL; END IF;
      END IF;
      IF candidate IS NULL AND pass = 1 THEN CONTINUE; END IF;
      IF candidate IS NULL THEN
        letter := coalesce(substring(normalized FROM '[A-Z]'), target.fallback);
        FOR n IN 1..999 LOOP
          EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE code = $1)', target.tbl) INTO taken USING letter || lpad(n::text, 3, '0');
          IF NOT taken THEN candidate := letter || lpad(n::text, 3, '0'); EXIT; END IF;
        END LOOP;
        IF candidate IS NULL THEN RAISE EXCEPTION '% に空いている % の番号がありません', target.tbl, letter; END IF;
      END IF;
      EXECUTE format('UPDATE %I SET code = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = $2', target.tbl) USING candidate, item.id;
    END LOOP;
  END LOOP;
  END LOOP;

  -- 割り当て先の番号と同じ英字・同じ数のタグだけを変え、同じUIDがすでにあれば残す。
  FOR item IN
    SELECT DISTINCT t.id, 'NFC-' || coalesce(en.code, vn.code) AS uid
    FROM "NfcTag" t
    JOIN "NfcAssignment" a ON a."nfcTagId" = t.id
    LEFT JOIN "Employee" e ON e.id = a."employeeId"
    LEFT JOIN "EmployeeNumber" en ON en.id = e."employeeNumberId"
    LEFT JOIN "Vehicle" v ON v.id = a."vehicleId"
    LEFT JOIN "VehicleNumber" vn ON vn.id = v."vehicleNumberId"
    WHERE t.uid ~ '^NFC-[A-Z][0-9]{1,2}$'
      AND coalesce(en.code, vn.code) = substr(t.uid, 5, 1) || lpad(substr(t.uid, 6), 3, '0')
    ORDER BY t.id
  LOOP
    IF NOT EXISTS (SELECT 1 FROM "NfcTag" WHERE uid = item.uid) THEN
      UPDATE "NfcTag" SET uid = item.uid, "updatedAt" = CURRENT_TIMESTAMP WHERE id = item.id;
    END IF;
  END LOOP;
END $$;

ALTER TABLE "EmployeeNumber" DROP CONSTRAINT IF EXISTS "EmployeeNumber_code_format";
ALTER TABLE "EmployeeNumber" ADD CONSTRAINT "EmployeeNumber_code_format" CHECK (code ~ '^[A-Z][0-9]{3}$');
ALTER TABLE "VehicleNumber" DROP CONSTRAINT IF EXISTS "VehicleNumber_code_format";
ALTER TABLE "VehicleNumber" ADD CONSTRAINT "VehicleNumber_code_format" CHECK (code ~ '^[A-Z][0-9]{3}$');
