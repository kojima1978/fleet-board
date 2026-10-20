# FleetFlow

FleetFlowは、社用車の駐車位置、予約、利用開始、返却、利用履歴を一元管理する社内向けWebアプリです。社員証と車両のNFCタグを使った操作にも対応します。

## 最初に読むところ

このプロジェクトはDockerで動かします。通常運用には**本番環境**、開発・動作確認には**開発環境**を使用してください。

| 用途 | 使用するファイル | データ |
| --- | --- | --- |
| 日常の業務運用 | `FleetFlow Production Start.cmd` | 本番DB |
| 本番へ最新版を反映 | `FleetFlow Production Update.cmd` | 本番DBを保持 |
| 開発・画面確認 | `FleetFlow Start.cmd` | 開発DB |

本番環境と開発環境は別のDBを使用します。同時には起動せず、起動用ファイルが反対側のコンテナーを自動停止します。

## 必要なもの

- Windows 10またはWindows 11
- Docker Desktop
- Git
- ChromeまたはEdge
- NFCを使う場合のみ：Sony RC-S300またはRC-S380、Sony NFCポートソフトウェア

Docker Desktopは起動用ファイルから起動できます。初回はDocker Desktopのセットアップを完了してから進めてください。

## 新しいPCへcloneした後の起動

PowerShellを開き、保存したいフォルダーで次を実行します。

```powershell
cd C:\Users\ユーザー名\Desktop\apps
git clone https://github.com/kojima1978/fleet-board.git
cd fleet-board
& '.\FleetFlow Production Start.cmd'
```

初回起動では次の処理を自動実行します。

1. `.env.production`を作成
2. 管理者PIN、DBパスワード、セッション秘密鍵を自動生成
3. Dockerイメージと本番DBを準備
4. DBスキーマと駐車区画の初期データを登録
5. アプリを起動してブラウザーを開く

画面に表示された管理者PINは、安全な場所へ保管してください。起動後のURLは[http://localhost:3035](http://localhost:3035)です。

> Gitに保存されるのはプログラムだけです。既存PCの社員・車両・予約・履歴などのDBデータと`.env.production`は、cloneだけでは新しいPCへ移りません。データ移行には「バックアップと復元」を使用してください。

## 既存フォルダーでpullした後の更新

本番データを使っているPCでは、単純な再起動ではなく、検査と自動復帰機能を備えた本番更新を使用します。

```powershell
cd C:\Users\ユーザー名\Desktop\apps\fleet-board
git status
git pull origin main
& '.\FleetFlow Production Update.cmd'
```

`git status`に自分で変更したファイルが表示された場合は、上書き事故を避けるため、pullする前に変更内容を確認してください。

本番更新は、更新前バックアップ、型検査、ビルド、DB移行、ヘルスチェック、主要操作テストを順番に実行します。途中で失敗した場合は本番切替を中止し、切替後の検査で失敗した場合は直前のアプリイメージへ自動復帰します。

更新後は次を実行して全体の状態を確認してください。

```powershell
& '.\FleetFlow Production Health Check.cmd'
```

## 日常の起動・停止・状態確認

エクスプローラーから次のファイルをダブルクリックできます。PowerShellでは、ファイル名に空白があるため`&`と引用符を付けます。

```powershell
# 起動
& '.\FleetFlow Production Start.cmd'

# 状態確認
& '.\FleetFlow Production Status.cmd'

# 詳細な健全性確認
& '.\FleetFlow Production Health Check.cmd'

# 起動前の設定・Docker・容量確認
& '.\FleetFlow Production Preflight.cmd'

# 停止（DBとバックアップは残ります）
& '.\FleetFlow Production Stop.cmd'
```

本番の通常起動は、最後に検証済みのイメージを再利用します。ソースをpullしただけでは本番へ反映されません。変更を反映するときだけ`FleetFlow Production Update.cmd`を実行してください。起動と更新の前には、Docker構成、秘密情報、公開アドレス、ポート、ディスク空きを自動点検します。NFC未接続や容量低下などは注意表示に留め、設定欠落など安全に起動できない場合だけ停止します。

## 開発環境

開発環境も必ずDockerで動かします。

```powershell
# Docker、開発用アプリ、DB、NFC Bridgeを確認して起動
& '.\FleetFlow Start.cmd'

# 状態確認
& '.\FleetFlow Status.cmd'
```

Dockerコマンドを直接使う場合：

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f app
```

停止・再開：

```powershell
docker compose stop
docker compose start
```

コンテナーを作り直す場合：

```powershell
docker compose down
docker compose up --build -d
```

`docker compose down`ではDBボリュームは消えません。`docker compose down -v`は開発DBを全削除するため、バックアップなしでは実行しないでください。

開発用DockerはDBが空かどうかを自動判定し、初回は現行スキーマを作成してから補助マイグレーションとサンプルデータ投入を行います。既存DBでは旧データを移行してから現行スキーマへ同期します。アプリとDBのポートは初期状態で`127.0.0.1`だけへ公開されます。

## 主な画面

| URL | 用途 |
| --- | --- |
| `/` | 駐車場配置図、利用開始、返却、利用中車両一覧 |
| `/timeline` | 車両タイムライン、予約、予定時間の変更 |
| `/operations` | 操作履歴、バックアップ・復元確認の状態 |
| `/settings` | 印刷などの設定 |
| `/settings/employees` | 社員登録、JSON取込、NFC UID登録 |
| `/settings/vehicles` | 車両登録、JSON取込、NFC UID登録 |
| `/print/parking` | A4横の空の駐車場配置図 |
| `/print/timeline` | A4横の空のタイムライン |

### 状態の意味

| 表示 | 意味 |
| --- | --- |
| 予約 | 将来の利用予定。まだ出庫していない |
| 利用中 | 利用開始手続きが完了し、車両が出庫している |
| 駐車中 | 車両が駐車区画にあり、配置図で位置を確認できる |
| 完了 | 返却手続きが完了した利用履歴 |
| 整備中 | 駐車位置と履歴を保持し、利用開始だけを一時停止している |

画面は5秒ごとに更新されます。同時操作は`version`列による楽観的ロックで競合を検出します。利用開始や返却などには一意の操作IDが付き、同じ通信が再送されても二重登録されません。

共用端末の駐車場・タイムライン画面では、10分間操作がないと社員選択と入力画面を解除し、駐車場画面へ戻ります。30秒前に警告され、操作すると継続できます。設定画面の編集中には適用されません。

## 基本操作

### 利用開始

1. 駐車場配置図で利用する車両を選びます。
2. 社員証をNFCで読むか、社員を手動選択します。
3. 利用予定時間を選び、「この内容で利用開始」を押します。
4. 車両が「利用中」になり、タイムラインへ反映されます。

### 予約

1. 利用開始画面で「時刻指定」を選びます。
2. 時間指定、終日、または複数日で登録します。
3. 予約時刻になったら社員証を読み、「予約した車両を利用開始」を押します。

予約時刻になっても自動では利用中になりません。利用開始の手続きが必要です。開始予定から30分以内に開始されなかった予約は自動取消され、履歴へ記録されます。使わないことが分かった時点で手動取消もできます。

### 返却

1. 駐車場配置図で返却先の空き区画を選びます。
2. 車両タグをNFCで読むか、利用中車両を手動選択します。
3. 内容を確認して返却を確定します。

早期返却ではタイムラインが実際の返却時刻まで短縮され、超過時は現在時刻まで延長されます。誤って返却した場合は、画面の取消操作から利用中へ戻せます。

## 社員・車両データ

- 社員は「設定 → 社員」、車両は「設定 → 車両」から登録します。
- 「JSON取込」で最大500件を一括登録できます。「ひな形を保存」で正しい形式を取得できます。
- JSON取込は新規登録専用です。重複や不正な行が1件でもある場合は全件を登録しません。
- NFC UIDは省略でき、取込後に編集画面から追加できます。
- UIDは区切り文字の有無にかかわらず正規化されます。
- 同じUIDを複数の社員・車両へ同時に割り当てることはできません。
- 社員番号と車両番号は将来再利用できますが、同じ番号を同時に有効化することはできません。
- 入替時は過去履歴を保つため、旧データを無効化してから新データを登録します。
- 車両にはETC・ナビの有無を登録できます。
- 一時的に使わない車両は「整備中」にします。利用中・予約中の車両は変更できません。

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
  { "code": "C19", "name": "営業車19", "plateNumber": "品川 500 い 56-78", "color": "#0891B2" }
]
```

社員番号、部署、NFCタグと割当関係は正規化された別テーブルで管理します。NFCの交換・失効・再利用履歴を保持し、操作履歴には表示名と社員IDを保存するため、改名後も操作者を追跡できます。

## NFC連携（RC-S300／RC-S380）

ブラウザーはPaSoRiと直接通信できないため、各利用PCでWindows用の「FleetFlow NFC Bridge」を動かします。NFC Tools KBCは不要です。

初回ビルドとインストール：

```powershell
docker compose --profile tools run --rm nfc-bridge-build
powershell -ExecutionPolicy Bypass -File .\nfc-bridge\install.ps1
```

インストール後はWindowsログイン時に自動起動します。接続確認は[http://127.0.0.1:17831/health](http://127.0.0.1:17831/health)を開き、`readerConnected`が`true`になることを確認します。詳細は[nfc-bridge/README.md](nfc-bridge/README.md)を参照してください。

LAN上のFleetFlowを使うPCでは、そのURLを許可Originに加えてインストールします。

```powershell
powershell -ExecutionPolicy Bypass -File .\nfc-bridge\install.ps1 `
  -AllowedOrigins "http://192.168.1.20:3035;http://localhost:3035"
```

NFC Bridgeやリーダーが停止しても、FleetFlow本体は社員・車両の手動選択で継続利用できます。

## 管理者PINとセキュリティ

社員・車両設定と操作履歴は管理者PINで保護され、認証は8時間有効です。設定変更APIも管理者セッションを検証します。PINを5回間違えると5分間ロックされます。

- 開発環境の初期PIN：`2468`
- 本番環境：初回起動時にランダム生成し`.env.production`へ保存

本番は非rootユーザー、読み取り専用ファイルシステム、Linux capability全削除で実行します。DBポートはWindowsへ公開せず、アプリにはCSPなどのセキュリティヘッダーを設定しています。NFC UIDは通常画面の一覧データへ含めず、読取時にサーバーで1件ずつ照合します。

## バックアップと復元

`db-backup`コンテナーが起動時と24時間ごとにバックアップを作成し、一時DBへ復元して検査します。30日を超えたバックアップは削除します。最終成功日時は「履歴」画面で確認できます。

手動バックアップ：

```powershell
# 開発DB
powershell -ExecutionPolicy Bypass -File .\scripts\database\Backup-Now.ps1

# 本番DB
powershell -ExecutionPolicy Bypass -File .\scripts\database\Backup-Now.ps1 -Production
```

復元できるかを検証：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\database\Verify-Backup.ps1 -Production
```

本番DBを実際に復元：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\database\Restore-Backup.ps1 `
  -Production -FileName fleet-YYYYMMDD-HHMMSS.sql.gz
```

実DBの復元は現在の内容を置き換えるため、ファイル名指定と`RESTORE`の確認入力が必要です。

PC故障に備える場合は`FleetFlow Production Backup Setup.cmd`を実行し、NAS、USB、OneDriveなどの同期フォルダーへ毎日複製してください。複製にはSHA-256検証が付き、保存先では新しい30ファイルを保持します。

### 新しいPCへ本番データを移す

古いPCで次を実行し、USBやNASなどを保存先に指定します。

```powershell
& '.\FleetFlow Production Migration Export.cmd'
```

新しいPCではリポジトリをcloneし、`FleetFlow Production Start.cmd`を一度実行してから次を実行します。

```powershell
& '.\FleetFlow Production Migration Import.cmd'
```

移行パッケージにはDBバックアップ、SHA-256、作成日時、Gitコミットを保存します。管理者PINやDBパスワードは移さず、新PC側で安全に再生成します。取込時は破損検査と復元検証を行い、最後に`RESTORE`と入力した場合だけ本番DBを置き換えます。

## 社内LANで本番公開する場合

初期設定では安全のため`127.0.0.1`だけへ公開され、同じPCからしか接続できません。LAN公開時は次をすべて実施してください。

1. サーバーPCへ固定LAN IPを設定します。
2. `FleetFlow Production Start.cmd`を一度実行して本番設定を作成します。
3. `FleetFlow LAN Setup.cmd`をダブルクリックします。自動検出した固定LAN IPをアプリへ設定し、管理者権限の確認後、TCP 3035を同じ社内サブネットからだけ許可します。
4. 表示された`http://LAN-IP:3035`を別PCで開きます。
5. インターネットと来客用Wi-Fiから到達できないことを別端末で確認します。
6. 可能なら社内証明書とリバースプロキシでHTTPS化し、`FLEETFLOW_COOKIE_SECURE=true`にします。
7. 信頼するリバースプロキシが転送ヘッダーを上書きする場合だけ`FLEETFLOW_TRUST_PROXY=true`にします。直接公開は`false`のままにします。
8. NFCを使う各PCへNFC Bridgeを入れ、LAN用Originを許可します。
9. バックアップはBitLocker対応ドライブまたは権限制御済みNASへ複製します。

LAN IPを自動検出できない場合は、PowerShellで明示できます。

```powershell
& '.\FleetFlow LAN Setup.cmd' -Address 192.168.1.20
```

この設定はアプリの公開ポートだけを変更します。PostgreSQLのポートはLANへ公開されません。ブラウザーとAPIは同じURLを使用するため、FleetFlow本体にCORSの追加設定は不要です。

通常の利用・返却には個人ログインを要求しない共用端末向け設計です。LANへ接続できる人は業務データを閲覧・操作できる前提なので、利用者ごとの権限管理が必要な環境では個別認証の追加が必要です。インターネットへ直接公開しないでください。

## 開発時の検査

すべてDocker内で実行します。

```powershell
# TypeScript
docker compose exec app npm run lint

# 利用開始、二重送信、返却、予約、変更、取消
docker compose exec app npm run test:integration

# NFC UIDを省略したJSON取込
docker compose exec app npm run test:integration:optional-nfc

# 履歴検索・状態表示・CSV出力
docker compose exec app npm run test:integration:operations

# Origin・プロキシ判定
docker compose exec app npm run test:security

# 本番LAN URL・サブネット計算（Windowsホスト）
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\production-network.test.ps1

# 依存関係
docker compose exec app npm audit
```

`FleetFlow Production Update.cmd`でも`npm audit --audit-level=high`を自動実行します。HighまたはCriticalが見つかった場合は本番切替を中止します。Moderate以下は更新を妨げず、個別に確認できます。

本番更新を画面表示なしで検査する場合：

```powershell
& '.\FleetFlow Production Update.cmd' -NoUi
```

DBスキーマは`prisma/migrations`の番号付きSQLで管理し、本番では`prisma db push`を使用しません。開発環境だけが現行スキーマへの同期に`db push`を使用します。

### 依存関係の監査方針

2026年10月13日時点でNext.jsは`16.4.0`です。Prisma CLI 7.10.0が固定する推移依存も含め、既知の脆弱性を避けるため`package.json`の`overrides`で次を固定しています。

- `deepmerge-ts` 8.0.2
- `mysql2` 3.24.5
- `source-map-js` 1.2.2

現在の`npm audit`は開発依存を含めて0件です。`npm audit fix --force`は互換性を壊す更新を含む可能性があるため使用しません。依存関係や`overrides`を変更した場合は、Docker内で監査、Prisma Client生成、本番ビルド、DB移行、統合テストを確認してください。

## トラブル対応

### 画面が開かない

```powershell
docker compose ps
docker compose logs --tail 100 app
docker compose restart app
```

本番の場合は、先に`FleetFlow Production Status.cmd`と`FleetFlow Production Health Check.cmd`を実行してください。

### 起動用cmdが動かない

- Docker Desktopの初期設定が完了しているか確認します。
- ファイル一式が同じプロジェクトフォルダーにあることを確認します。
- PowerShellからは`& '.\FleetFlow Production Start.cmd'`のように実行します。
- 詳細は`nfc-bridge/fleetflow-start.log`を確認します。

### NFC連携ソフトを起動するよう表示される

1. RC-S300／RC-S380を接続し直します。
2. [NFC Bridgeのヘルス画面](http://127.0.0.1:17831/health)を確認します。
3. Windowsへ再ログインするか、NFC Bridgeを再インストールします。
4. 復旧するまでは社員・車両を手動選択します。

### データ更新が競合した

別の端末で先に変更されています。最新状態を読み直し、内容を確認してからもう一度操作してください。

### 履歴を絞り込み・保存したい

「履歴」画面では、利用者・内容のキーワード、操作種別、開始日、終了日で絞り込めます。「CSV」を押すと現在の検索条件に一致する履歴を最大10,000件まで保存します。同じ画面でアプリ、DB、NFC、バックアップの状態と、アプリ・DBバージョンを確認できます。

### 本番障害の情報を保存したい

`FleetFlow Production Diagnostics.cmd`を実行します。コンテナー状態、アプリ、NFC、ディスク、直近ログを`diagnostics`フォルダーのZIPへ保存します。`.env.production`やDBパスワードは含みません。

## 補足

- `.env.production`、DBデータ、バックアップ、診断ZIPはGitへ登録しません。
- 本番バックアップは`backups/production`、開発バックアップは`backups`へ保存します。
- 更新前や異常を感じたときは`FleetFlow Production Health Check.cmd`を実行してください。
- 「異常」は起動・更新を止める項目、「注意」は外部バックアップ未設定、空き容量不足、再起動回数増加など早めの確認が必要な項目です。
