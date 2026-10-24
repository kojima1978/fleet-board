-- 設定画面でUIDを消して外した割り当て。利用停止で外したものと区別し、再開しても戻さない。
ALTER TABLE "NfcAssignment" ADD COLUMN "cleared" BOOLEAN NOT NULL DEFAULT false;
