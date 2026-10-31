-- 初期設定のまま保存された案内だけを、新しいデフォルトへ合わせる。
-- 利用者が編集した設定（version > 1、文面・音声を変更済み）は変更しない。
UPDATE "ParkingGuidanceSetting"
SET "enabled" = CASE
  WHEN "event" IN ('BLOCKED_OUT', 'BLOCKED_IN') THEN true
  ELSE false
END
WHERE "version" = 1
  AND "audioBase64" IS NULL
  AND (
    ("event" = 'DEPARTURE' AND "message" = '車を出します。周囲の安全を確認してください。')
    OR ("event" = 'SELECT_SPOT' AND "message" = '車を停める駐車区画を選択してください。')
    OR ("event" = 'ARRIVAL' AND "message" = '駐車区画と周囲の安全を確認してください。')
    OR ("event" = 'BLOCKED_OUT' AND "message" = '手前に車があるため出庫できません。先に手前の車を移動してください。')
    OR ("event" = 'BLOCKED_IN' AND "message" = '手前に車があるため入庫できません。先に手前の車を移動してください。')
  );
