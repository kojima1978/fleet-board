# NFC機能の削除手順（未実施）

QRコード（QK30-U）一本で運用するため、将来NFC機能を削除するときの作業メモです。2026-10-29時点の調査結果で、まだ何も削除していません。行番号は変わるため、関数名や文言で探してください。

## 方針

- 画面・API・DB・README・テスト・スクリプトからNFCを外し、QRだけで社員と車両を読み取れる状態にする。
- ブリッジ（`nfc-bridge`）はQRイベントも中継しているため残す。フォルダ名、exe、`NFC_BRIDGE_URL`、環境変数`NEXT_PUBLIC_NFC_BRIDGE_URL`は変えない。本番のスクリプトが`nfc-bridge\...`を参照している。
- ブリッジ本体（`Program.cs`、`messages.ja.json`、導入手順）のNFC読み取り部分を消すかどうかは、別途判断する。
- NFCを含む古いJSONバックアップも復元できるようにする。`nfcTags`と`nfcAssignments`は読み飛ばす。

## 作業順

1. 画面
2. API
3. DBとバックアップ
4. 補助ファイル、テスト、スクリプト、README
5. `tsc`、lint、テスト、画面確認

## 1. 画面

### components/settings-panel-v2.tsx

- **import**
  - `Nfc`アイコン
  - `normalizeNfcUid`と`sameNfcUid`
  - `nfcBridgeStatusText`と`useNfcBridge`
  - `NfcBridgeHelp`
  - `UserRound`は`NfcCheckDialog`でしか使っていないため、あわせて外せる。
- **型と定数**
  - `NfcFilter`、`matchesNfc`、`NfcChangeConfirm`
  - `emptyEmployee`と`emptyVehicle`の`nfcUid`
  - `NFC_SCAN_TIMEOUT_MS`、`nfcUidLabel`
- **state**
  - `nfc`と`setNfc`（NFC絞り込み）
  - `nfcEmployee`、`nfcEmployeeValue`、`nfcVehicle`、`nfcVehicleValue`
  - `scanning`（NFC読み取り専用）
  - `nfcChangeConfirm`、`nfcCheckOpen`
- **URLパラメータ**
  - `nfc`の読み書きと、effectの依存配列
- **検索・絞り込み**
  - 検索対象の`nfcUid`
  - `matchesNfc`
- **重複チェック**
  - `currentNfc`、`duplicateNfc`、`nfcVehicleDuplicate`、`nfcEmployeeDuplicate`
  - `editingId`は`duplicateNfc`でしか使っていない。
- **変更有無の比較**
  - `nfcUid`の比較
- **ドロワーとキー操作**
  - `closeDrawer`の`setScanning(false)`と`setNfcChangeConfirm(null)`
  - Escキー処理のNFC分岐と依存配列
- **開閉と保存の関数**
  - `openEmployee`と`openVehicle`の`nfcUid`
  - `openEmployeeNfc`、`closeEmployeeNfc`、`openVehicleNfc`、`closeVehicleNfc`、`beginNfcScan`
  - `persistEmployee`と`persistVehicle`の`duplicateNfc`判定と`nfcUid`送信
  - `persistEmployeeNfc`、`persistVehicleNfc`、`applyNfcChange`
- **JSON取込**
  - `nfcUid`の検証
  - テンプレート例の`nfcUid`
  - 送信データの`nfcUid`
  - 説明文「NFC UIDは省略でき…」
  - プレビュー表のNFC列
- **一覧の画面**
  - 検索欄のプレースホルダーにある「NFC UID」
  - NFC絞り込みのselect
  - 「NFCを確認」ボタン
  - 絞り込み解除の`setNfc("all")`
  - 社員一覧と車両一覧の「NFC UID」列（見出しと各行）
  - 列を減らしたあと、`employeeGrid`と`vehicleGrid`の列定義を詰める。
- **ダイアログと部品**
  - 登録ボタンの`duplicateNfc`による無効化
  - 社員NFCダイアログ、車両NFCダイアログ、NFC変更確認のalertdialog
  - `RowActions`のNFC用propsとボタン
  - `activeChangeEffects`にあるNFCカード・タグの文言を、NFCなしで書き直す。
  - `NfcField`、`NfcOwner`型、`NfcCheckDialog`

### そのほかの画面

- **components/app-header.tsx**: ヘッダーの「NFC接続」を「QR接続」にする。
- **components/scanner-guide.tsx**: NFCの案内文を外す。
- **components/system-status-panel.tsx**: NFCのStatusCardを外す。
- **components/operations-dashboard.tsx**: `useNfcBridgeHealth`を外す。
- **components/nfc-bridge-help.tsx**: 削除するか、QRスキャナの案内に書き直す。
- **components/data-backup-panel.tsx**: NFC件数などの表示を外す。
- **components/idle-traffic.tsx**: NFCに触れたコメントを直す。
- **components/fleet-dashboard.tsx**: NFCに触れた箇所を確認する。
- **app/layout.tsx**: descriptionの「NFC対応の…」を直す。

## 2. API

### app/api/dashboard/route.ts

- **import と補助関数**
  - `normalizeNfcUid`のimport
  - `LatestNfcAssignment`型と`restorableNfcTag`
  - `withVehicleCode`と`withEmployeeCode`の`nfcAssignments`条件と`nfcUid`出力
  - `assertNfcAvailable`、`nfcUidSchema`、`optionalNfcUidSchema`
- **スキーマ**
  - 取込スキーマと、`createEmployee`、`createVehicle`、`updateEmployee`、`updateVehicle`の`nfcUid`
  - `updateEmployeeNfc`と`updateVehicleNfc`のaction
- **GET の取得**
  - 社員、車両、予約の`include`にある`nfcAssignments: { include: { nfcTag: true }, ... }`
  - 「NFC検索を避ける」のコメント
- **各処理のNFC部分**
  - `createEmployee`、`createVehicle`、`updateEmployee`、`updateVehicle`
  - `updateEmployeeNfc`と`updateVehicleNfc`の処理全体
  - `setEmployeeActive`と`setVehicleActive`（停止時のカード解除、再開時のカード復元）
  - `importEmployees`と`importVehicles`（JSON内の重複チェック、使用中チェック、作成）
- **エラー文言**
  - `employeeAction`の判定にある`"updateEmployeeNfc"`
  - 重複エラーの文言「…・NFC UIDのいずれかが…」

### その他のAPI

- **app/api/nfc/resolve/route.ts**: 削除する。
- **lib/resolve-nfc.ts**: `NfcResolution`型を`lib/resolve-qr.ts`へ移してから削除する。`resolve-qr.ts`がこの型をimportしている。

## 3. DBとバックアップ

### prisma/schema.prisma

- `NfcTag`と`NfcAssignment`のmodelを削除する。
- `Employee`と`Vehicle`にある`nfcAssignments NfcAssignment[]`を削除する。

### マイグレーション

次のSQLで新しいマイグレーションを作る。

```sql
DROP TABLE "NfcAssignment";
DROP TABLE "NfcTag";
```

作ったら`db:migrate:deploy`と`db:generate`を実行する。

### lib/json-backup.ts

- 書き出しから`nfcTags`と`nfcAssignments`を外す。
- 読み込みでは、この2つのキーを受け付けたうえで無視する。スキーマは`.strict()`なので、キーごと消すと古いバックアップが復元できなくなる。
- 復元時の`createMany`と件数表示から外す。

### lib/backup-integrity.ts

- NFCの件数と整合性チェックを外す。

## 4. 補助ファイル、テスト、スクリプト、README

### lib

- **lib/types.ts**: `Employee`と`Vehicle`の`nfcUid`を削除する。
- **lib/use-nfc-bridge.ts**:
  - `kind: "nfc"`の処理、`useNfcBridge`、`useNfcBridgeHealth`、`nfcBridgeStatusText`を外す。
  - `useScannerBridge`の準備完了判定を`qrReaderConnected`だけにする。
  - 「NFCリーダーまたはQRスキャナ」の文言を「QRスキャナ」にする。
  - `NfcBridgeStatus`は`ScannerBridgeStatus`への改名を検討する。
- **lib/device-mode.ts**:
  - `isKioskDevice(mode, nfcStatus)`の引数を見直す。
  - 設定キー`fleetflow.nfcSound`は、既存端末の設定が消えないよう、キーを残すか移行処理を入れる。
  - `isNfcSoundEnabled`は`lib/fuel-voice.ts`も使っている。
- **lib/nfc-sound.ts**: `playNfcSound`はQR読み取り音としても使っているか確認し、使っていれば`scan-sound`などに改名する。
- **lib/nfc.ts**: 参照がなくなったら削除する。
- **lib/employee-session.ts**: NFCに触れたコメントを直す。

### seed とスクリプト

- **prisma/seed.ts**: NFCタグの投入をやめる。
- **scripts/migrations**: `migrate-nfc-uids.mjs`と`migrate-unified-nfc-assignments.mjs`を削除する。`migrate-employee-normalization.mjs`のNFC部分も確認する。
- **scripts/production/prepare-migrations.mjs**、**scripts/development/prepare-db.sh**、**scripts/production/prepare-db.sh**: 上の移行スクリプトを呼んでいる箇所を外す。
- **package.json**: `test:integration:optional-nfc`、`db:migrate:nfc-uids`、`db:migrate:unified-nfc`を外す。

### テスト

- **tests/integration/optional-nfc-import.mjs**: NFC部分を外し、JSON取込のテストとして名前を変えて残す。装備、軽自動車、ガソリンカードの確認を含んでいる。
- **NFCを含むもの**: `tests/scanner-monitoring.test.ts`、`tests/scanner-setup.test.ts`、`tests/integration/department-management.mjs`、`tests/integration/database-hardening.ts`、`tests/integration/vehicle-parking.mjs`
- **フィクスチャの`nfcUid: ""`を消すもの**: `tests/departure-guidance.test.tsx`、`tests/parking-appearance.test.ts`、`tests/parking-reservations.test.tsx`

### ドキュメント

- **README.md**: NFCの説明、NFCリーダーの導入、NFC関連のコマンドを外す。
- **docs/**: `database-design-review-2026-10-28.md`と`database-hardening.md`のNFCの記述を直す。

### 変更しないもの

- `compose.yaml`、`Dockerfile`、`.gitignore`、`.dockerignore`
- `nfc-bridge/`の中身（ブリッジの扱いを決めるまで）

## 確認

- `docker compose exec -T app npx tsc --noEmit -p .`
- `npm run -s lint`
- 単体テスト
  - `test:parking-appearance`
  - `test:parking-reservations`
  - `test:departure-guidance`
  - `test:scanner-monitoring`
  - `test:scanner-setup`
- 結合テスト
  - JSON取込（改名後）
  - `test:integration:json-backup`
  - `test:integration:parking`
  - `test:integration:maintenance`
  - `test:integration:departments`
  - `test:integration:database-hardening`
- 画面確認
  - ヘッダーのQR接続表示
  - 社員と車両の一覧、登録、編集
  - QRでの出庫と返却
  - NFCを含む古いJSONバックアップの復元
- 本番では、更新前にJSONバックアップを取り、利用者の了承を得てからマイグレーションを適用する。
