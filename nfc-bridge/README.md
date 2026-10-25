# FleetFlow NFC・QR Bridge

RC-S300／RC-S380をWindows PC/SCで、DENSO QK30-UをUSB-COMで読み取り、同じPCのFleetFlowブラウザー画面へ読取結果を渡す常駐ソフトです。NFCとQRは同時に待ち受けます。通信は `127.0.0.1:17831` のみに限定し、許可したWebアプリのOrigin以外には結果を返しません。

## ビルド（Docker）

```powershell
docker compose --profile tools run --rm nfc-bridge-build
```

`nfc-bridge/dist/FleetFlow.NfcBridge.exe` が生成されます。

## Windowsへインストール

NFCだけ使う場合は、Sony NFCポートソフトウェアとRC-S300／RC-S380を準備し、PowerShellで実行します。

```powershell
powershell -ExecutionPolicy Bypass -File .\nfc-bridge\install.ps1
```

QK30-Uも使う場合は、[DENSO WAVEのQK30ダウンロードページ](https://www.denso-wave.com/ja/adcd/product/scanner/qk30/dl/)からActive USB-COMドライバーをインストールし、デバイス マネージャーでCOM番号を確認します。QK30-UをUSB-COMモード、終端をCRまたはCR/LFにして、`COM3`を実際の番号へ置き換えます。

```powershell
powershell -ExecutionPolicy Bypass -File .\nfc-bridge\install.ps1 -QrComPort COM3
```

標準の通信速度は9600bpsです。QK30-U側の設定を変えた場合だけ、たとえば`-QrBaudRate 115200`も指定します。
QK30-UがDENSOのCOMポートとして1台だけ認識されている場合は、`-QrComPort`を省略してもインストーラーが自動検出します。検出できない場合や複数台ある場合は明示してください。

FleetFlowを別のURLで開く場合は、そのOriginを指定します。

```powershell
powershell -ExecutionPolicy Bypass -File .\nfc-bridge\install.ps1 -AllowedOrigins "http://fleetflow.local;http://localhost:3035"
```

インストール先は `%LOCALAPPDATA%\FleetFlow\NfcBridge` です。Windowsログイン時に監視用ランチャーを自動起動し、Bridgeが停止した場合は5秒ごとに検出して自動再起動します。RC-S300／RC-S380またはQK30-UをUSBから抜いてもBridgeは待機を続け、再度接続すると通常は数秒以内に自動認識します。FleetFlowやBridgeを手動で再起動する必要はありません。デスクトップショートカットは作成しません。あわせて`fleetflow-nfc://`を登録し、Bridge自体へ接続できない場合にFleetFlow画面から起動できるようにします。この機能より前にインストールしたPCでは、もう一度インストールすると使えるようになります。

通常はプロジェクト直下の `FleetFlow Start.cmd` をダブルクリックしてください。Docker Desktop、FleetFlow本体、DB、NFC連携ソフトを順番に確認・起動し、準備完了後にブラウザーを開きます。`FleetFlow Status.cmd` では本体、NFC連携ソフト、NFCリーダーの状態を確認できます。

自動起動・再起動の履歴は `%LOCALAPPDATA%\FleetFlow\NfcBridge\nfc-bridge-launch.log` で確認できます。

## 動作確認

ブラウザーで `http://127.0.0.1:17831/health` を開きます。NFCは`readerConnected`、QRは`qrReaderConnected`が`true`なら接続済みです。`qrConfigured`が`false`なら、`-QrComPort`を付けて再インストールしてください。社員・車両の設定画面ではQR画像を表示・保存できます。

USBを抜くと該当する接続状態が`false`になり、挿し直すと通常は数秒以内に自動的に`true`へ戻ります。NFCはPC/SCのリーダー一覧、QRはQK30-UのUSB識別子（VID/PID）を監視します。QK30-UがWindowsへ再認識されたのにシリアル接続だけが復旧しない場合は、連続した再接続失敗を検出してBridgeだけを自動再起動します。USBを外したままのときは再起動を繰り返しません。USBハブや差込口を変えてQK30-UのCOM番号が変わった場合も、新しいポートへ自動追従するため再インストールは不要です。QK30-Uを複数台接続した場合だけ、使用するCOMポートを明示して再インストールしてください。FleetFlow画面も定期的に再確認され、ページを再読み込みしなくても接続済み表示へ戻ります。未接続時は画面右上のシステム状態に「再接続」が表示され、押すとBridgeと読取機器の接続を作り直します。

自動復旧しない場合は、FleetFlow画面右上の黄色いシステム状態を押して、次の順で確認します。

1. RC-S300／RC-S380またはQK30-Uを一度抜き、挿し直して数秒待つ
2. 画面に表示された「再接続」を押し、5～15秒待つ
3. `http://127.0.0.1:17831/health`を開き、NFCは`readerConnected`、QRは`qrReaderConnected`を確認する
4. Bridge自体が開けない場合は、Windowsへ再ログインするかBridgeを再インストールする
5. NFCだけが戻らない場合はWindowsの「スマート カード」サービスとSony NFCポートソフトウェア、QRだけが戻らない場合はActive USB-COMドライバーとデバイス マネージャーのCOMポートを確認する

復旧までの間も、FleetFlow本体は社員と車両を画面から手動選択して利用できます。
