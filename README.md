# FleetFlow

NFCタグで社員と車両を識別し、社用車の予約・利用開始・返却、タイムライン、駐車位置を一画面で管理する社内向けWebアプリです。

## 必要なもの

- Windows 10／11
- Docker Desktop
- ブラウザー（ChromeまたはEdgeを推奨）
- NFCを使用する場合：Sony RC-S300またはRC-S380とNFCポートソフトウェア

## 起動・停止

初回起動または再ビルド：

```powershell
docker compose up --build -d
```

起動後に [http://localhost:3035](http://localhost:3035) を開きます。初回起動時にPrismaのスキーマ反映とサンプルデータ投入が自動実行されます。

状態確認：

```powershell
docker compose ps
docker compose logs -f app
```

停止・再開：

```powershell
docker compose stop
docker compose start
```

コンテナを作り直す場合：

```powershell
docker compose down
docker compose up --build -d
```

`docker compose down`だけではデータベースのDockerボリュームは削除されません。`docker compose down -v`は全データを削除するため、バックアップなしでは実行しないでください。

## 画面

| URL | 用途 |
| --- | --- |
| `/` | 駐車場配置図、利用開始、返却、利用中車両一覧 |
| `/timeline` | 車両タイムライン、予約、予定時間の変更 |
| `/settings/employees` | 社員登録・NFC UID登録 |
| `/settings/vehicles` | 車両登録・NFC UID登録 |
| `/settings` | 印刷などの設定 |
| `/operations` | 操作履歴、DBバックアップ・復元確認の状態 |
| `/print/parking` | A4横の駐車場配置図 |
| `/print/timeline` | A4横の空タイムライン |

## 基本操作

### 利用開始

1. 駐車場配置図で利用する車両を選びます。
2. 社員証のNFCタグを読み取ります。NFCが使用できない場合は社員を手動選択できます。
3. 利用予定時間を選び、「この内容で利用開始」を押します。
4. 登録後は車両が「利用中」になり、タイムラインへ反映されます。

### 予約

1. 利用開始画面で「時刻指定」を選びます。
2. 時間指定・終日・複数日から予定を登録します。
3. 予約時刻になったら社員証を読み取り、「予約した車両を利用開始」を押します。時間の再入力は不要です。

予約時刻だけでは自動的に利用中になりません。開始予定から30分以内に利用開始されなかった予約は自動取消され、監査履歴に「予約自動取消」として記録されます。使わないことが分かった時点で手動取消することもできます。

### 返却

1. 駐車場配置図で空き区画を選びます。
2. 車両のNFCタグを読み取ります。NFCが使用できない場合は車両を手動選択できます。
3. 返却内容を確認して確定します。

予定より早い返却ではタイムラインが実際の返却時刻まで短縮されます。予定を超過している場合は、現在時刻まで利用中の表示が延長されます。誤って返却した場合は、画面に表示される取消操作から利用中へ戻せます。

## 状態の定義

| 表示 | 意味 |
| --- | --- |
| 予約 | 将来の利用予定。まだ出庫していない状態 |
| 利用中 | 利用開始手続きを行い、車両が出庫している状態 |
| 駐車中 | 車両が駐車区画にあり、配置図上で位置を確認できる状態 |
| 完了 | 返却手続きが完了した利用履歴 |

画面は5秒ごとに自動更新されます。データ更新は`version`列を使った楽観的ロックで競合を検出します。

## 社員・車両の登録

- 社員は「設定 → 社員」、車両は「設定 → 車両」から登録します。
- 各一覧の「JSON取込」から最大500件を一括登録できます。「ひな形を保存」で正しい形式を取得できます。
- JSON取込は新規登録専用です。社員番号・車両番号・ナンバー、および指定されたNFC UIDの重複や不正な行が1件でもある場合、全件を登録せず元の状態を保ちます。
- NFC UIDは省略または空欄でも取り込めます。取り込み後、社員・車両の編集画面からNFC読取で追加できます。
- 車両はETC・ナビの有無を登録でき、車両一覧、利用開始画面、駐車場配置図に装備タグを表示します。
- 車両JSONの`hasEtc`と`hasNavigation`は任意の真偽値です。省略時は`false`（なし）になります。
- 指定されたNFC UIDは区切り文字の有無にかかわらず正規化して保存されます。
- 同じNFC UIDを複数の社員・車両へ登録することはできません。
- 社員番号・車両番号は再利用できる設計ですが、同じ番号を同時に有効化することはできません。
- 過去履歴を残すため、入替時は旧データを無効化してから新しいデータを登録します。

社員JSONの例：

```json
[
  { "code": "E007", "name": "山田 太郎", "department": "営業部", "nfcUid": "04AABBCCDDEEFF" },
  { "code": "E008", "name": "鈴木 花子", "department": "総務部" }
]
```

車両JSONの例：

```json
[
  { "code": "C18", "name": "営業車18", "plateNumber": "品川 500 あ 12-34", "nfcUid": "04AABBCCDDEE11", "color": "#2563EB", "hasEtc": true, "hasNavigation": true },
  { "code": "C19", "name": "営業車19", "plateNumber": "品川 500 い 56-78", "color": "#0891B2", "hasEtc": false, "hasNavigation": true }
]
```

### 社員データの管理方針

- 社員番号は`EmployeeNumber`、部署は`Department`として社員本体から分離しています。
- 有効な社員へ同じ社員番号を重複割当できないDB制約があります。
- NFC UIDは`NfcTag`、社員・車両との関係は共通の`NfcAssignment`で管理し、交換・失効・再利用の履歴を保持します。
- 同じNFCタグを社員・車両をまたいで同時に複数へ割り当てることはできません。
- 操作履歴は表示名に加えて社員IDも保存するため、改名後も操作者を追跡できます。

## RC-S300／RC-S380 NFC連携

ブラウザーとPaSoRiは直接通信せず、Windows専用のNFC Bridgeを介して読み取ります。NFC Tools KBCは不要です。

ビルド：

```powershell
docker compose --profile tools run --rm nfc-bridge-build
```

インストール：

```powershell
powershell -ExecutionPolicy Bypass -File .\nfc-bridge\install.ps1
```

Windowsログイン時に自動起動します。接続確認はブラウザーで [http://127.0.0.1:17831/health](http://127.0.0.1:17831/health) を開き、`readerConnected`が`true`になることを確認します。詳細は[NFC BridgeのREADME](nfc-bridge/README.md)を参照してください。

## FleetFlowの開発環境起動と状態確認

デスクトップショートカットは使用しません。開発フォルダー直下の次のファイルを使用します。

- `FleetFlow Start.cmd`：Docker Desktop、本体、DB、NFC Bridgeを確認・起動し、準備完了後にブラウザーを開きます。
- `FleetFlow Status.cmd`：本体、NFC Bridge、NFCリーダーの状態を表示します。

通常は `FleetFlow Start.cmd` をダブルクリックするだけで起動できます。NFC BridgeだけはWindowsログイン時にも自動起動します。

ファイル名の`FleetFlow`と`Start`の間には半角スペースがあります。PowerShellから起動する場合は `& '.\FleetFlow Start.cmd'` のように引用符で囲んでください。

正常時は起動通知を表示しません。NFCだけ使用できない場合は「注意」として手動操作が可能なことと対処方法を表示します。DockerまたはFleetFlow本体を起動できない場合は「起動エラー」として原因と対処方法を日本語で表示し、Dockerの詳細エラーを`nfc-bridge\fleetflow-start.log`へ記録します。

画面上部にはアプリの更新状態とNFC接続状態を表示します。データ更新に失敗した場合は、最終更新時刻と「再接続」を表示し、古い情報を正常な情報として見せないようにしています。Dockerの`app`と`db`にはヘルスチェックと自動再起動を設定しています。

## 本番環境の起動

本番環境は開発環境と別のコンテナー・DBボリューム・バックアップ先を使用します。開発フォルダー直下の次のファイルを使用します。

- `FleetFlow Production Start.cmd`：本番設定を初回だけ自動生成し、本番イメージ、DB、バックアップ、NFC Bridgeを起動
- `FleetFlow Production Update.cmd`：バックアップ、ビルド、型検査、DB移行、切替、主要操作テストを行い、失敗時は直前のアプリへ自動復帰
- `FleetFlow Production Status.cmd`：本体、NFC Bridge、NFCリーダーの状態確認
- `FleetFlow Production Stop.cmd`：本番コンテナーを停止。DBとバックアップは保持
- `FleetFlow Production Diagnostics.cmd`：コンテナー、アプリ、NFC、ディスク、直近ログを秘密情報なしのZIPへ保存
- `FleetFlow Production Backup Setup.cmd`：NAS、USB、同期フォルダーへの毎日19時のバックアップ複製を設定

初回は`FleetFlow Production Start.cmd`をダブルクリックします。ランダムな管理者PIN、DBパスワード、セッション秘密鍵を`.env.production`へ生成し、管理者PINだけを画面に表示します。`.env.production`はGit管理対象外です。表示されたPINは安全な場所へ保管してください。

通常の起動では、最後に検証済みの本番イメージをそのまま使用するため、ソース変更や通信障害の影響を受けません。変更を本番へ反映するときだけ`FleetFlow Production Update.cmd`を使用します。更新前バックアップと復元検証に失敗した場合は更新を開始しません。ビルド、型検査、起動、ヘルスチェック、主要操作テストのいずれかが失敗した場合は、直前のアプリイメージへ自動復帰します。

本番と開発は同じ`3035`ポートを使用するため、本番起動時は開発コンテナーを停止し、開発起動時は本番コンテナーを停止します。DBデータはそれぞれ独立して保持されます。本番DBには駐車区画だけを初期登録し、デモ社員・デモ車両・デモ予定は登録しません。

本番構成は次を適用します。

- Next.jsのstandalone本番イメージを非rootユーザーで実行
- DBポートをWindows側へ公開しない
- ソースコード、`node_modules`、`.next`を本番コンテナーへマウントしない
- DB準備完了後にのみアプリを起動
- 自動再起動、ヘルスチェック、CPU・メモリ上限を設定
- Dockerログを1ファイル10MB・最大3ファイルへ制限
- 本番バックアップを`backups\production`へ保存し、毎回復元検証
- Prismaマイグレーション履歴でDB変更を番号管理
- 初期状態では`127.0.0.1`だけへ公開し、同じWindows PC以外からのアクセスを遮断

設定画面にはアプリバージョン、実行環境、最終更新日時、バックアップ確認日時を表示します。障害調査時は`FleetFlow Production Diagnostics.cmd`で`diagnostics`フォルダーへ診断ZIPを作成してください。`.env.production`やDBパスワードは診断ZIPへ含めません。

## 管理者PIN

社員・車両の設定画面は管理者PINで保護され、認証は8時間有効です。開発環境の初期PINは`2468`です。本番環境では初回起動時にランダムなPINと秘密鍵を`.env.production`へ生成します。

```env
FLEETFLOW_ADMIN_PIN=任意の4～12桁の数字
FLEETFLOW_SESSION_SECRET=十分に長いランダム文字列
```

設定変更APIも同じ管理者セッションを検証するため、画面を迂回した未認証の登録・変更は拒否されます。PINを5回間違えると5分間ロックされます。

## バックアップ

`db-backup`コンテナが起動時と24時間ごとにDBを`backups`フォルダーへ自動保存し、直後に一時DBへ復元して社員・車両テーブルを検査します。30日を超えたファイルは削除します。バックアップと復元確認の最終成功日時は「履歴」画面で確認できます。

手動バックアップ：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\database\Backup-Now.ps1
```

本番DBを手動バックアップする場合：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\database\Backup-Now.ps1 -Production
```

PC故障にも備える場合は`FleetFlow Production Backup Setup.cmd`を実行し、NAS、USBドライブ、OneDrive等の同期フォルダーを選択します。毎日19時にバックアップ作成、復元検証、SHA-256付き複製を行います。保存先では新しい30ファイルを保持します。USBを保存先にする場合は、実行時刻に接続されている必要があります。

バックアップを一時DBへ復元し、社員・車両テーブルを検査します。本番DBは変更しません。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\database\Verify-Backup.ps1
```

本番バックアップは同じコマンドへ`-Production`を追加します。

復元確認の成功日時も「履歴」画面へ表示されます。実DBの復元は現在の内容を置き換えるため、ファイル名指定と`RESTORE`の確認入力が必要です。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\database\Restore-Backup.ps1 -FileName fleet-YYYYMMDD-HHMMSS.sql.gz
```

本番DBを復元する場合は、同じコマンドへ`-Production`を追加します。

操作更新には一意の操作IDを付けています。同じ通信を再送しても利用開始・返却・予約などは二重登録されません。通信は10秒で区切り、同じ操作IDで一度だけ自動再送した後、最新状態を取得します。オフライン中は警告を表示し、接続復旧時または画面へ戻った時に自動同期します。

## 開発時の確認

TypeScriptチェック：

```powershell
docker compose exec app npm run lint
```

主要操作（利用開始、同時二重送信、返却再送、予約、時間変更、予約取消）のAPI結合テスト：

```powershell
docker compose exec app npm run test:integration
```

テスト専用の社員・車両・区画を一時作成し、終了時に削除します。実運用データは変更しません。

本番更新の確認：

```powershell
& '.\FleetFlow Production Update.cmd' -NoUi
```

DBスキーマは`prisma\migrations`の番号付きSQLで管理します。既存DBは初回更新時に現在の構造をベースラインとして記録し、新規DBには同じベースラインを適用します。以後は`prisma db push`を本番更新に使用しません。

### 依存関係のセキュリティ監査

本番依存関係の監査：

```powershell
docker compose exec app npm audit --omit=dev
```

2026年10月5日時点では、Prisma CLI 7.10.0が固定している推移依存の脆弱性を避けるため、`package.json`の`overrides`で`deepmerge-ts` 8.0.2と`mysql2` 3.24.5を使用します。`npm audit`は開発依存を含めて0件です。Prisma本体を6系へダウングレードする`npm audit fix --force`は使用しません。

この上書きを変更・削除するときは、Docker内で`npm audit`、Prisma Client生成、本番ビルド、DBマイグレーション、統合テストを実行してください。Prismaが修正版の依存関係を正式採用した後は、Prismaを更新して`overrides`を削除できます。

## トラブル対応

### 画面が開かない

```powershell
docker compose ps
docker compose logs --tail 100 app
docker compose restart app
```

### NFC連携ソフトを起動するよう表示される

1. RC-S300／RC-S380を接続し直します。
2. [NFC Bridgeのヘルス画面](http://127.0.0.1:17831/health)を確認します。
3. Windowsを再ログインするか、NFC Bridgeを再起動します。
4. 復旧しない場合は画面の手動選択を使用します。

### データ更新が競合した

別の端末で先に変更された可能性があります。画面を更新して最新状態を確認し、もう一度操作してください。

## 本番公開時の注意

`compose.production.yaml`は1台のWindows PCで安定運用する構成で、初期設定では`127.0.0.1`だけへ公開します。管理者PINは設定変更を保護しますが、アプリ全体のユーザー認証ではありません。LAN公開へ変更する場合は、`.env.production`の`FLEETFLOW_BIND_ADDRESS`を変更するだけでなく、利用者認証、HTTPS、Windowsファイアウォールの接続元制限を同時に設定し、HTTPS化後に`FLEETFLOW_COOKIE_SECURE=true`へ変更してください。インターネットへ直接公開しないでください。
