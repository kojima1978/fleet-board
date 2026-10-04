# FleetFlow NFC Bridge

RC-S300／RC-S380をWindows PC/SCで読み取り、同じPCのFleetFlowブラウザー画面へUIDを渡す常駐ソフトです。通信は `127.0.0.1:17831` のみに限定し、許可したWebアプリのOrigin以外にはUIDを返しません。

## ビルド（Docker）

```powershell
docker compose --profile tools run --rm nfc-bridge-build
```

`nfc-bridge/dist/FleetFlow.NfcBridge.exe` が生成されます。

## Windowsへインストール

Sony NFCポートソフトウェアとRC-S300／RC-S380を準備し、PowerShellで実行します。

```powershell
powershell -ExecutionPolicy Bypass -File .\nfc-bridge\install.ps1
```

FleetFlowを別のURLで開く場合は、そのOriginを指定します。

```powershell
powershell -ExecutionPolicy Bypass -File .\nfc-bridge\install.ps1 -AllowedOrigins "http://fleetflow.local;http://localhost:3035"
```

インストール先は `%LOCALAPPDATA%\FleetFlow\NfcBridge` です。Windowsログイン時にNFC Bridgeだけを自動起動します。デスクトップショートカットは作成しません。

通常はプロジェクト直下の `FleetFlow Start.cmd` をダブルクリックしてください。Docker Desktop、FleetFlow本体、DB、NFC連携ソフトを順番に確認・起動し、準備完了後にブラウザーを開きます。`FleetFlow Status.cmd` では本体、NFC連携ソフト、NFCリーダーの状態を確認できます。

## 動作確認

ブラウザーで `http://127.0.0.1:17831/health` を開き、`readerConnected` が `true` になれば接続済みです。社員登録画面で「NFC読取」を押してカードをかざしてください。
