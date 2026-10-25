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

インストール先は `%LOCALAPPDATA%\FleetFlow\NfcBridge` です。Windowsログイン時に監視用ランチャーを自動起動し、NFC Bridgeが停止した場合は5秒ごとに検出して自動再起動します。RC-S300／RC-S380をUSBから抜いてもBridgeは待機を続け、再度接続すると通常は数秒以内に自動認識します。FleetFlowやBridgeを手動で再起動する必要はありません。デスクトップショートカットは作成しません。あわせて`fleetflow-nfc://`を登録し、FleetFlow画面の「連携ソフトを起動」からNFC Bridgeを起動できるようにします（起動するだけで、URLの内容は使いません）。この機能より前にインストールしたPCでは、もう一度インストールすると使えるようになります。

通常はプロジェクト直下の `FleetFlow Start.cmd` をダブルクリックしてください。Docker Desktop、FleetFlow本体、DB、NFC連携ソフトを順番に確認・起動し、準備完了後にブラウザーを開きます。`FleetFlow Status.cmd` では本体、NFC連携ソフト、NFCリーダーの状態を確認できます。

自動起動・再起動の履歴は `%LOCALAPPDATA%\FleetFlow\NfcBridge\nfc-bridge-launch.log` で確認できます。

## 動作確認

ブラウザーで `http://127.0.0.1:17831/health` を開き、`readerConnected` が `true` になれば接続済みです。社員登録画面で「NFC読取」を押してカードをかざしてください。

USBを抜くと `readerConnected` が `false`、挿し直すと通常は数秒以内に自動的に `true` へ戻ります。FleetFlow画面のNFC状態も定期的に再確認され、ページを再読み込みしなくても接続済み表示へ戻ります。

自動復旧しない場合は、FleetFlow画面右上の黄色いNFC状態を押して案内を開き、次の順で確認します。

1. RC-S300／RC-S380を一度抜き、挿し直して数秒待つ
2. `http://127.0.0.1:17831/health` の `readerConnected` を確認する
3. Bridge自体が開けない場合は、画面の「連携ソフトを起動」を押す
4. それでも戻らない場合だけ、Windowsの「スマート カード」サービスとSony NFCポートソフトウェアを確認する

復旧までの間も、FleetFlow本体は社員と車両を画面から手動選択して利用できます。
