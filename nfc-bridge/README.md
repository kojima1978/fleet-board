# FleetFlow NFC・QR Bridge

RC-S300／RC-S380をWindows PC/SCで、DENSO QK30-UをUSB-COMで読み取り、同じPCのFleetFlowブラウザー画面へ読取結果を渡す常駐ソフトです。NFCとQRは同時に待ち受けます。通信は `127.0.0.1:17831` のみに限定し、許可したWebアプリのOrigin以外には結果を返しません。

## ビルド（Docker）

利用PCでは、アプリのNFC接続ヘルプから「初回セットアップ」をダウンロードして実行するだけで導入できます。Docker・.NETの別途導入やURL入力は不要です。接続先はダウンロード名から引き継ぐためファイル名を変更しないでください。exeはサーバーのDockerイメージビルド時に生成・同梱します。管理者権限は不要で、現在のWindowsユーザーのログイン時にBridge監視を自動起動します。既存設定も保持します。Windowsの実行確認・社内ポリシーによる制限は省略できません。

この初回セットアップは、一般利用者ではなくFleetFlowの導入担当者またはPC管理者が、USB読取機器を使用するPCごとに1回実施します。別PCへ機器を移した場合は、そのPCでも実行します。セットアップ後の日常利用者はBridgeを操作する必要はありません。

プロジェクト一式があるPCでは、ドライバー導入後にUSB接続し、Windowsの`FleetFlow Start.cmd`または`FleetFlow Production Start.cmd`を実行する方法もあります。機器を検出して未導入のBridgeを初回ビルド・導入・起動します。この経路はDockerが必要です。導入済みならインストール先のBridgeを再利用し、Windowsログイン時の自動起動登録は変更しません。

```powershell
docker compose --profile tools run --rm nfc-bridge-build
```

`nfc-bridge/dist/FleetFlow.NfcBridge.exe` が生成されます。通常の導入は、その後に`nfc-bridge\FleetFlow NFC-QR Install.cmd`をダブルクリックします。CMDは内部で`install.ps1`を安全な実行オプション付きで呼び出します。

## Windowsへインストール

NFCだけ使う場合は、Sony NFCポートソフトウェアとRC-S300／RC-S380を準備し、PowerShellで実行します。

ドライバーの入手先：[Sony公式 NFCポートソフトウェア](https://www.sony.co.jp/Products/felica/consumer/support/download/nfcportsoftware.html)。Windowsの起動ファイルは、対応リーダーのドライバー未導入（コード28）を検出すると公式ページを開きます（`-NoUi`では開きません）。ドライバーのインストールは利用者自身で行ってください。

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

インストール先は `%LOCALAPPDATA%\FleetFlow\NfcBridge` です。Windowsログイン時に監視用ランチャーを自動起動し、Bridgeが停止した場合は5秒ごとに検出して自動再起動します。RC-S300／RC-S380またはQK30-UをUSBから抜いてもBridgeは待機を続け、再度接続すると通常は数秒以内に自動認識します。FleetFlowやBridgeを手動で再起動する必要はありません。

セットアップ後の管理ファイルは `%LOCALAPPDATA%\FleetFlow\NfcBridge` に保存します。デスクトップとスタートメニューへショートカットは作成しません。USB機器を挿し直しても復旧しない場合は、このフォルダーの `FleetFlow NFC-QR Restart.cmd` をダブルクリックしてください。Bridgeが起動中ならNFC・QR接続を作り直し、停止・フリーズ中ならBridgeと監視機能を起動して、結果を日本語で表示します。削除する場合は同じフォルダーの `FleetFlow NFC-QR Uninstall.cmd` を実行します。一般利用者のPCにはセットアップ自体が不要です。

ブラウザーからWindowsアプリを起動するカスタムURL機能は使用しません。Bridge自体へ接続できない場合は、FleetFlowの「設定 → NFC・QR 接続ガイド」に表示された管理フォルダーとCMDの手順で復旧します。BridgeはUSB機器を使うPCごとの登録です。別PCではFleetFlow画面から初回セットアップを実行すると、そのPCにも一式が登録されます。旧版でカスタムURLやショートカットを登録したPCでは、もう一度セットアップすると不要な登録を削除します。

通常はプロジェクト直下の `FleetFlow Start.cmd` をダブルクリックしてください。Docker Desktop、FleetFlow本体、DB、NFC連携ソフトを順番に確認・起動し、準備完了後にブラウザーを開きます。`FleetFlow Status.cmd` では本体、NFC連携ソフト、NFCリーダーの状態を確認できます。

自動起動・再起動の履歴は `%LOCALAPPDATA%\FleetFlow\NfcBridge\nfc-bridge-launch.log` で確認できます。

## 動作確認

ブラウザーで `http://127.0.0.1:17831/health` を開きます。NFCは`readerConnected`、QRは`qrReaderConnected`が`true`なら接続済みです。`qrConfigured`が`false`なら、`-QrComPort`を付けて再インストールしてください。社員・車両の設定画面ではQR画像を表示・保存できます。

USBを抜くと該当する接続状態が`false`になり、挿し直すと通常は数秒以内に自動的に`true`へ戻ります。NFCはPC/SCのリーダー一覧、QRはQK30-UのUSB識別子（VID/PID）を監視します。QK30-UがWindowsへ再認識されたのにシリアル接続だけが復旧しない場合は、連続した再接続失敗を検出してBridgeだけを自動再起動します。USBを外したままのときは再起動を繰り返しません。USBハブや差込口を変えてQK30-UのCOM番号が変わった場合も、新しいポートへ自動追従するため再インストールは不要です。QK30-Uを複数台接続した場合だけ、使用するCOMポートを明示して再インストールしてください。FleetFlow画面も定期的に再確認され、ページを再読み込みしなくても接続済み表示へ戻ります。画面右上のシステム状態は概要だけを表示し、手動再接続と復旧手順は「設定 → NFC・QR 接続ガイド」に集約しています。

自動復旧しない場合は、FleetFlow画面右上の黄色いシステム状態を押して、次の順で確認します。

1. RC-S300／RC-S380またはQK30-Uを一度抜き、挿し直して数秒待つ
2. 画面に表示された「再接続」を押し、5～15秒待つ
3. `http://127.0.0.1:17831/health`を開き、NFCは`readerConnected`、QRは`qrReaderConnected`を確認する
4. Bridge自体が開けない場合は「設定 → NFC・QR 接続ガイド」を開き、管理フォルダーの`FleetFlow NFC-QR Restart.cmd`を実行する
5. NFCだけが戻らない場合はWindowsの「スマート カード」サービスとSony NFCポートソフトウェア、QRだけが戻らない場合はActive USB-COMドライバーとデバイス マネージャーのCOMポートを確認する

復旧までの間も、FleetFlow本体は社員と車両を画面から手動選択して利用できます。
