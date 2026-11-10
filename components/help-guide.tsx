"use client";

import { Children, cloneElement, createElement, Fragment, isValidElement, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDownToLine, ArrowUp, Ban, Building2, CalendarClock, CarFront, Clock3, Database, IdCard, LayoutGrid, LifeBuoy, MapPin, Printer, ScanLine, Search, Settings, Undo2, UserMinus, UserPlus, Users, Volume2, Wrench } from "lucide-react";
import { isKioskDevice, useDeviceMode } from "@/lib/device-mode";
import { useNfcBridgeHealth, useQrBridgeHealth } from "@/lib/use-nfc-bridge";
import { AppHeader, Navigation } from "./app-header";
import { FrontSpotFigure, MaintenanceFlowFigure, RestoreFlowFigure, ReturnFlowFigure, SettingsScreenFigure, SpotRoleFigure, StartFlowFigure } from "./help-figures";
import { Button, Card, cn } from "./ui";

type Section = { id: string; title: string; icon: ReactNode; intro?: string; steps?: ReactNode[]; notes?: ReactNode[]; figure?: ReactNode; wide?: boolean };
type Group = { title: string; sections: Section[] };

// 画面のボタン名は「」で囲み、実際の表示と同じ言葉にする。画面を変えたらここも合わせて直す。
const USER_SECTIONS: Section[] = [
  { id: "screens", title: "画面の見方", icon: <LayoutGrid className="size-5" />, intro: "上のメニューで画面を切り替えます。", notes: [
    <><b>駐車場</b>：配置図で車の場所・ガソリン残量・利用中の車を確認し、利用開始と返却をします。</>,
    <><b>タイムライン</b>：車ごとの予約・利用・車検予定を確認し、予約をします。「予定一覧」では先の予定を日付順に確認できます。</>,
    <><b>履歴</b>：だれが・いつ車を使ったか（車両利用履歴）と、だれが何を変更したか（操作履歴）を確認します。</>,
    <><b>設定</b>：社員・車両・駐車区画・案内などを管理します（管理者向け）。</>,
    <>右上の利用者の表示に、いま操作している人の名前が出ます。「×」で解除します。</>,
  ] },
  { id: "terminal", title: "共用端末と各自のPC", icon: <Users className="size-5" />, intro: "右上の「共用端末」「各自のPC」の表示で、この端末の使い方が分かります。押すと切り替えられます。", notes: [
    <><b>共用端末</b>：社員証をかざすか社員QRを読んで、自分を確認してから操作します。利用開始・予約・返却を終えるか、しばらく操作がないと自動で解除されます。次の人は自分の社員証をかざしてから操作してください。</>,
    <><b>各自のPC</b>：一覧から自分を選びます。選んだ人はこのPCに残ります。</>,
    <>社員証が使えないときは「社員番号で探す（手動選択）」を押し、社員番号か氏名で探します。テンキーでは社員番号の数字だけを入力します（Eは不要）。</>,
  ] },
  { id: "start", title: "車を使う（今すぐ利用）", icon: <CarFront className="size-5" />, steps: [
    <>駐車場の配置図で、使う車を押します。</>,
    <>「今すぐ利用」を押します。</>,
    <>社員証をかざすか社員QRを読みます（各自のPCでは一覧から選びます）。</>,
    <>返却予定の時間を選び、「この内容で利用開始」を押します。</>,
  ], notes: [
    <>車両タグをかざすか車両QRを読むと、その車の利用開始の画面がすぐ開きます。</>,
    <>ガソリンが少ない車では、給油のお願いが出ます。</>,
    <>手前の区画に車があると、黄色の注意が出ます。出られるか確認してから利用開始してください。</>,
  ], figure: <StartFlowFigure /> },
  { id: "reserve", title: "予約する", icon: <CalendarClock className="size-5" />, steps: [
    <>配置図で車を押して「予約する」を押します。タイムラインの左の車両名を押しても開けます。</>,
    <>「時間で予約」「1日利用」（6:00〜22:00）「日をまたいで利用」（最大7日）から選び、日時を指定します。</>,
    <>「この内容で予約」を押します。</>,
    <>予約の時刻になったら、配置図でその車を押し、「今すぐ利用」から「予約した車両を利用開始」を押します。</>,
  ], notes: [
    <>予約の時刻になっても、自動では利用中になりません。必ず利用開始の操作をしてください。</>,
    <>開始予定から30分たっても利用開始しない予約は、自動で取り消されます。</>,
    <>予約を変えるときは、タイムラインの予約の帯か「予定一覧」の利用予約を押し、「変更内容を確認」→「この内容で予約を変更」と進みます。</>,
    <>「予定一覧」は30日表示が初期値です。7日・30日・90日を切り替えられ、利用予約・車検予定・車検中を日付順に表示します。日付は11/5(木) 今日のように同じ位置へ揃えて表示します。</>,
    <>使わなくなった予約は、同じ画面の下の赤い「この予約を取り消す」で取り消します。</>,
  ] },
  { id: "extend", title: "延長する", icon: <Clock3 className="size-5" />, steps: [
    <>配置図の右の「利用中」か、配置図で自分の車を押します。タイムラインで利用中の帯を押しても開けます。</>,
    <>「30分」「1時間」「2時間」「3時間」「終日」から延ばす時間を選びます。「変更後」に延長後の時刻が出ます。</>,
    <>「延長する」を押します。</>,
  ], notes: [
    <>次の予約や車検の予定と重なる時間には延長できません。次の予約は詳細に出ていて、1時間を切ると黄色で知らせます。</>,
    <>早く戻ったときは、短縮せずにそのまま返却してください。</>,
  ] },
  { id: "return", title: "返す（返却）", icon: <MapPin className="size-5" />, steps: [
    <>駐車場の配置図で、車を停めた区画を押します。返却できる空き区画は緑に点滅します。</>,
    <>車両タグをかざすか車両QRを読みます（または利用中の車を一覧から選びます）。</>,
    <>ガソリン残量を「F・3/4・1/2・1/4・E」から選びます。おおよそで構いません。</>,
    <>「区画◯◯へ返却する」を押します。</>,
  ], notes: [
    <>「利用中」の車を押して「返却する」からでも始められます。そのあと配置図で区画を選びます。</>,
    <>お客様用の区画を選ぶと黄色の注意が出ます。できるだけ「別の区画を選ぶ」で通常の区画へ停めてください。</>,
    <>専用の区画には、決められた車しか停められません。</>,
  ], figure: <ReturnFlowFigure /> },
  { id: "fix", title: "間違えたときに直す", icon: <Undo2 className="size-5" />, notes: [
    <><b>返却を間違えた</b>：返却の直後に出る「返却を取り消す」を30秒以内に押すと、利用中へ戻せます。</>,
    <><b>停めた区画が違う</b>：配置図で車を押し、「位置変更」を押します。移動先の区画を押すか、車をドラッグします。社員証は要りません。</>,
    <><b>ガソリン残量が違う</b>：配置図で車を押し、「残量変更」で選び直します。</>,
    <><b>利用開始の時刻が違う</b>：「履歴 → 車両利用履歴 → その他：利用開始時刻を訂正」で、正しい時刻と理由を入れて直します。</>,
    <><b>場所が決まっていない車</b>：配置図の右の「位置未設定」の車を押し、置く区画を押します。</>,
  ] },
  { id: "trouble", title: "困ったとき", icon: <LifeBuoy className="size-5" />, notes: [
    <><b>社員証・車両タグが反応しない</b>：右上の黄色い「NFC未接続」などの表示を押し、「再接続」を押します。直らないときは「社員番号で探す（手動選択）」で一覧から選んでください。</>,
    <><b>登録されていないカードと出た</b>：画面の下に出る番号（UID）を管理者に伝えて、登録してもらってください。</>,
    <><b>手前の区画に車があると出た</b>：出庫・入庫できない場合があります。手前の車を確認してから操作してください。注意だけなので、登録はそのまま続けられます。</>,
    <><b>ほかの端末で変更されたと出た</b>：画面を開き直し、最新の内容を確認してからもう一度操作してください。</>,
  ] },
];

// 管理者向けは「やりたいこと別」に並べる。手順は「どの画面 → どのボタン → 何を入れる → 最後に確認」の順で書く。
const ADMIN_GROUPS: Group[] = [
  { title: "はじめに", sections: [
    { id: "admin-screen", title: "設定画面の見方", icon: <Settings className="size-5" />, wide: true, intro: "上のメニューの「設定」を押すと開きます。各設定画面の見出しの右にある「この画面の使い方」を押すと、このページの説明へ移ります。", figure: <SettingsScreenFigure /> },
  ] },
  { title: "社員", sections: [
    { id: "employee-add", title: "新しい社員が入った", icon: <UserPlus className="size-5" />, steps: [
      <>「設定 → 社員登録」を開き、右上の「社員を追加」を押します。</>,
      <>社員番号（英字1文字と数字3桁。例：E007）・氏名・メールアドレス・部署を入れ、「社員を登録」を押します。部署が無いときは、先に「設定 → 部署」で追加します。</>,
      <>社員証を使うときは、一覧のその人の行の「NFC登録」→「NFCカードを登録」を押し、社員証をかざします。番号が出たら「このカードを登録」→「このNFCを登録」を押します。</>,
      <>社員QRを使うときは、行の「QR」を押し、「SVG保存」で保存するか、「…へ送信」で本人にメールします。</>,
      <>一覧に名前・部署・NFCの登録が出ていることを確かめます。</>,
    ], notes: [
      <>何人もまとめて登録するときは「JSON取込」を使います。「ひな形を保存」で形式を確認できます。</>,
      <>全員の社員QRをまとめてメールするときは「QRメール」を使います。</>,
    ] },
    { id: "employee-leave", title: "社員が辞めた・異動した", icon: <UserMinus className="size-5" />, steps: [
      <>「設定 → 社員登録」で、その人の行の「編集」を押します。</>,
      <><b>異動</b>：部署を選び直し、「変更を保存」を押します。</>,
      <><b>退職</b>：下の「この社員の利用を停止」→「利用を停止」を押します。利用者の一覧に出なくなり、社員証・社員QRも使えなくなります。</>,
      <>一覧の絞り込みを「利用停止中」にすると、止めた人を確認できます。</>,
    ], notes: [
      <>利用を停止しても、これまでの利用履歴は残ります。</>,
      <>また使うときは、「利用停止中」の一覧から「利用再開」を押します。</>,
    ] },
    { id: "employee-card", title: "社員証やQRを無くした・新しくした", icon: <IdCard className="size-5" />, steps: [
      <><b>社員証を新しくした</b>：その人の行の「NFC変更」→「NFCカードを変更」を押し、新しい社員証をかざして「このカードへ変更」を押します。</>,
      <><b>社員証を無くした</b>：「NFC変更」の画面で「このカードの登録を解除」を押します。拾われても使えなくなります。</>,
      <><b>社員QRを無くした・破れた</b>：行の「QR」→「管理操作」→「紛失・破損のため再発行」→「再発行する」を押します。古いQRは使えなくなるので、新しいQRを保存するか本人へ送り直します。</>,
    ], notes: [
      <>持ち主の分からないカードは、一覧の上の「NFCを確認」を押してかざすと、だれのカードか分かります。</>,
    ] },
    { id: "departments", title: "部署を追加・変更する", icon: <Building2 className="size-5" />, steps: [
      <>「設定 → 部署」を開きます。</>,
      <>部署名を入れて「追加」を押します。</>,
      <>並び順は、行の上下の矢印で変えます。社員を選ぶ画面もこの順に並びます。</>,
      <>名前を直すときは「編集」を押し、直して「保存」を押します。</>,
    ], notes: [
      <>使わなくなった部署は「編集」から利用停止できます。所属している社員がいる部署は止められないので、先に社員の部署を変えます。</>,
    ] },
  ] },
  { title: "車両", sections: [
    { id: "vehicle-add", title: "車を増やした・入れ替えた", icon: <CarFront className="size-5" />, steps: [
      <>「設定 → 車両登録」を開き、右上の「車両を追加」を押します。</>,
      <>車両番号（英字1文字と数字3桁。例：C018）・車両名・ナンバーを入れます。</>,
      <>停める区画を、空いている区画から選びます。場所が決まっていなければ仮置きを選び、あとで配置図の「位置変更」で動かします。</>,
      <>車種（普通車・軽自動車）・装備・表示色・ガソリンカードの名前を選び、「車両を登録」を押します。</>,
      <>車両タグを使うときは、行の「NFC登録」でタグをかざして登録します。車両QRは行の「QR」→「SVG保存」で保存し、印刷して車に貼ります。</>,
      <>駐車場の配置図に、その車が出ていることを確かめます。</>,
    ], notes: [
      <>ガソリンカードは番号ではなく、「出光 末尾1234」のように見分けられる名前だけを登録します。</>,
      <>入れ替えのときは、新しい車を登録してから、古い車の利用を停止します。</>,
    ] },
    { id: "vehicle-retire", title: "車を使わなくなった", icon: <Ban className="size-5" />, steps: [
      <>「設定 → 車両登録」で、その車の行の「編集」を押します。</>,
      <>下の「この車両の利用を停止」を押して確認します。</>,
      <>配置図から消え、区画が空いたことを確かめます。</>,
    ], notes: [
      <>利用中・予約あり・整備中・車検の予定がある車は停止できません。先に返却・予約の取り消し・整備の解除をします。</>,
      <>利用を停止しても、これまでの利用履歴は残ります。</>,
    ] },
  ] },
  { title: "車検・故障", sections: [
    { id: "maintenance-flow", title: "車検・故障の流れ", icon: <Wrench className="size-5" />, wide: true, intro: "車を区画に置いたまま止める「故障（駐車場内）」と、区画を空けて出す「車検・修理で外出」の2つがあります。", figure: <MaintenanceFlowFigure /> },
    { id: "maintenance-out", title: "車検・修理に出す", icon: <CalendarClock className="size-5" />, steps: [
      <>「設定 → 車両登録」で、その車の行の「車検・故障」を押し、「車検・修理で外出」を選びます。</>,
      <>開始予定（1年先まで）と戻り予定（開始から90日以内）を入れ、「予定を登録」を押します。その期間は予約できなくなります。</>,
      <>当日、車を出すときに、駐車場の配置図でその車を押し、「車検を開始（予定 …）」→「車検を開始」を押します。</>,
      <>車が配置図から外れ、右の「車検中」に出ていることを確かめます。</>,
    ], notes: [
      <>予定は自動では始まりません。必ず「車検を開始」を押してください。</>,
      <>予定を登録せずにすぐ出すときは、「車検・修理で外出」の「今すぐ」→「車検で外出にする」を押します。</>,
      <>タイムラインで車検の予定の帯を押しても、予定を確かめられます。当日は「車検を開始」から駐車場の画面へ移って始められます。</>,
    ] },
    { id: "maintenance-back", title: "車検・修理から戻ってきた", icon: <Undo2 className="size-5" />, steps: [
      <>駐車場の配置図の右の「車検中」で、戻ってきた車を押します。</>,
      <>「車検を終了」を押します。</>,
      <>停めた区画を配置図で押し（車をドラッグしても選べます）、ガソリン残量を選びます。</>,
      <>「区画◯◯に停めて終了」を押し、配置図に車が戻ったことを確かめます。</>,
    ], notes: [
      <>戻りが遅れるときは、同じ画面で戻り予定を延ばせます。</>,
      <>タイムラインで車検中の帯を押しても、同じ画面を開けます。「車検を終了」を押すと駐車場の画面へ移り、区画選びから始まります。</>,
    ] },
    { id: "maintenance-broken", title: "故障して使えない", icon: <AlertTriangle className="size-5" />, steps: [
      <>「設定 → 車両登録」で、その車の行の「車検・故障」を押し、「故障（駐車場内）」を選びます。</>,
      <>「今すぐ」→「整備中にする」を押します。車は区画に置いたまま、利用と予約だけが止まります。</>,
      <>直ったら、駐車場の配置図でその車を押し、「整備解除」→「整備を解除」を押します。</>,
    ] },
  ] },
  { title: "駐車場", sections: [
    { id: "spot-role", title: "区画の設定を変える", icon: <MapPin className="size-5" />, wide: true, steps: [
      <>「設定 → 駐車区画」を開き、配置図か一覧で区画を押します。</>,
      <>区画を使わないときは「配置図に表示」をオフにします。設定画面ではグレーの破線と「非表示」で確認でき、通常の駐車場画面からは完全に消えます。車が駐車中なら、先に別の区画へ移動します。</>,
      <>用途を選びます。「専用」のときは、専用にする車両も選びます。</>,
      <>必要に応じて「推奨車種」を「指定なし」「普通車用」「軽自動車用」から選びます。</>,
      <>必要なら区画番号と表示名（配置図で番号の横に出す名前。「自動」か「任意」で10文字以内）を直します。</>,
      <>「保存」を押します。区画番号を変えたときは、確認が出るので「変更する」を押します。</>,
      <>配置図の色と表示名が変わったことを確かめます。</>,
    ], notes: [
      <>表示をオフにした区画は配置図・駐車先・手前の区画の判定から外れます。オンに戻すと再び使えます。</>,
      <>推奨車種と違う車も駐車できますが、確定前に注意と車種に合う空き区画が表示されます。</>,
    ], figure: <SpotRoleFigure /> },
    { id: "front-spots", title: "手前の区画を設定する", icon: <ArrowDownToLine className="size-5" />, wide: true, intro: "奥の区画から車を出し入れするときに、通り道になる区画です。ここに車があると、利用開始・返却のときに注意が出ます。", steps: [
      <>「設定 → 駐車区画」で、奥の区画を押します。</>,
      <>「手前の区画」で、中央の道路側にある区画を選びます。</>,
      <>「保存」を押します。</>,
    ], notes: [
      <>注意を出すだけで、利用開始や返却は止めません。</>,
      <>「初期設定に戻す」で、最初の設定に戻せます。</>,
    ], figure: <FrontSpotFigure /> },
  ] },
  { title: "案内・データ・緊急時", sections: [
    { id: "guidance", title: "案内の文面・音声を変える", icon: <Volume2 className="size-5" />, steps: [
      <>「設定 → 案内設定」を開きます。</>,
      <><b>駐車案内</b>：出庫・区画選び・入庫・出庫できない・入庫できないの5つから選び、読み上げ文を直すか音声ファイルを入れ、「試聴」で確かめて「この案内を保存」を押します。</>,
      <><b>ガソリン案内</b>：「利用開始時」「返却時」を選び、残量（F〜E）ごとに案内のオン・オフ・メッセージ・表示方法を決めて、「残量 ◯ の設定を保存」を押します。</>,
      <><b>給油時のお礼</b>：給油してくれた人へのメッセージを直し、「お礼設定を保存」を押します。</>,
    ], notes: [
      <>音声ファイルはMP3・WAV（2MBまで）です。ドラッグ＆ドロップで入れられます。</>,
      <>音声が鳴るのは共用端末だけです。端末ごとの音のオン・オフは、右上の「共用端末」「各自のPC」の表示を押して「音声・効果音」で切り替えます。</>,
      <>「初期設定に戻す」で、文面と音声を最初の状態に戻せます。</>,
    ] },
    { id: "data", title: "データを保存する・元に戻す", icon: <Database className="size-5" />, steps: [
      <><b>保存</b>：「設定 → データ保存・復元」で「JSONで保存」を押します。全データが1つのJSONファイルになります。</>,
      <><b>元に戻す</b>：同じ画面で、保存したJSONを枠へドラッグ＆ドロップします。</>,
      <>「復元できるファイルです」と件数が出たら、内容が正しいか確かめます。</>,
      <>確認欄に「RESTORE」と入力し、「このJSONで全データを復元」を押します。</>,
    ], notes: [
      <>復元すると、今のデータがすべて置き換わります。復元の前に、今のデータも「JSONで保存」しておくと安心です。</>,
      <>JSONには個人情報や社員証の番号が入っています。安全な場所に保管してください。</>,
      <>自動のバックアップとは別のものです。自動バックアップも止めずに使ってください。</>,
    ], figure: <RestoreFlowFigure /> },
    { id: "reader", title: "読み取り機・システムの状態を見る", icon: <ScanLine className="size-5" />, notes: [
      <>社員証・車両タグの読み取りが直らないときは、「設定 → NFC・QR」の「NFC・QRを再接続」を押します。初めて取り付けるときの手順もここにあります。</>,
      <>「設定 → システム」で、アプリ・データベース・バックアップ・NFC・QRの状態をまとめて確認できます。</>,
    ] },
    { id: "emergency", title: "システムが使えないとき", icon: <Printer className="size-5" />, steps: [
      <>「設定 → 緊急時」を開きます。</>,
      <>「空白の配置図」か「空白のタイムライン」を押し、印刷します（A4横）。</>,
      <>システムが止まっている間は、紙に記録します。直ったら、紙の内容をもとに位置や残量を直します。</>,
    ], notes: [
      <>いざというときのため、前もって何枚か印刷しておくと安心です。</>,
    ] },
  ] },
];

const ALL_IDS = new Set([...USER_SECTIONS, ...ADMIN_GROUPS.flatMap((group) => group.sections)].map((section) => section.id));
const ADMIN_IDS = new Set(ADMIN_GROUPS.flatMap((group) => group.sections.map((section) => section.id)));
// ヘッダーの下に隠れる高さ。これより下に見えている最初の説明を、いま読んでいる項目にする。
const READING_LINE = 120;

const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

// figure を真にすると、図の部品を呼び出して中の文字も読む。図の部品はフックを使わないので、そのまま呼び出せる。
function nodeText(node: ReactNode, figure = false): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((child) => nodeText(child, figure)).join(" ");
  if (!isValidElement<{ children?: ReactNode }>(node)) return "";
  if (figure && typeof node.type === "function") return nodeText((node.type as (props: unknown) => ReactNode)(node.props), figure);
  return nodeText(node.props.children, figure);
}

// 説明は書き換わらないので、検索に使う文字は最初に一度だけ作る。
const SECTION_TEXT = new Map([...USER_SECTIONS, ...ADMIN_GROUPS.flatMap((group) => group.sections)].map((section) => [section.id, normalize([
  ...[section.title, section.intro ?? "", ...(section.steps ?? []), ...(section.notes ?? [])].map((node) => nodeText(node)),
  nodeText(section.figure, true),
].join(" "))]));
const sectionMatches = (section: Section, keyword: string) => !keyword || (SECTION_TEXT.get(section.id) ?? "").includes(keyword);

// 検索した言葉に合う部分を探す正規表現。normalize と同じく、空白の違いと英字の大小は区別しない。
const keywordPattern = (keyword: string) => keyword ? new RegExp(`(${[...keyword].map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*")})`, "gi") : null;

function highlight(text: string, pattern: RegExp | null): ReactNode {
  const parts = pattern ? text.split(pattern) : [text];
  if (parts.length === 1) return text;
  return createElement(Fragment, null, ...parts.map((part, index) => index % 2 === 0 ? part : <mark className="rounded-sm bg-amber-200 text-inherit print:bg-transparent">{part}</mark>));
}

// 説明の中のカギかっこで囲んだ言葉（ボタン名など）を、画面のボタンに似た見た目にする。検索した言葉にも色を付ける。
function withLabels(node: ReactNode, pattern: RegExp | null): ReactNode {
  if (typeof node === "string") {
    const parts = node.split(/「([^「」]+)」/);
    if (parts.length === 1) return highlight(node, pattern);
    return createElement(Fragment, null, ...parts.map((part, index) => index % 2 === 0 ? highlight(part, pattern) : <span className="mx-0.5 rounded-md border border-slate-300 bg-white px-1.5 py-px font-bold text-slate-900 shadow-sm [box-decoration-break:clone] print:shadow-none">{highlight(part, pattern)}</span>));
  }
  if (isValidElement<{ children?: ReactNode }>(node) && node.props.children !== undefined) return cloneElement(node, undefined, ...Children.toArray(node.props.children).map((child) => withLabels(child, pattern)));
  return node;
}

export function HelpGuide() {
  const nfcHealth = useNfcBridgeHealth(true);
  const qrHealth = useQrBridgeHealth(true);
  const kiosk = isKioskDevice(useDeviceMode(), nfcHealth === "ready" || qrHealth === "ready" ? "ready" : nfcHealth);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ id: string } | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  // 目次などで移った直後は、移った先を目次の現在地にしておく。利用者が自分でスクロールしたら追い始める。
  const followScroll = useRef(true);
  // 終わりのひらがな1文字は比べない（取り消し・取り消す のどちらでも見つける）。
  const keyword = normalize(query).replace(/(?<=.{2})[ぁ-ん]$/, "");
  const pattern = keywordPattern(keyword);
  const userSections = USER_SECTIONS.filter((section) => sectionMatches(section, keyword));
  const adminGroups = ADMIN_GROUPS.map((group) => ({ ...group, sections: group.sections.filter((section) => sectionMatches(section, keyword)) })).filter((group) => group.sections.length > 0);
  // 共用端末では、管理者向けの説明を最初は閉じておく。検索したときと、管理者の項目へ移ったときは開く。
  const adminCollapsed = kiosk && !adminOpen && !keyword;
  const empty = userSections.length === 0 && adminGroups.length === 0;

  const jumpTo = useCallback((id: string) => {
    if (ADMIN_IDS.has(id)) setAdminOpen(true);
    followScroll.current = false;
    setActiveId(id);
    setFlash({ id });
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
  }, []);

  useEffect(() => {
    const onHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (ALL_IDS.has(id)) jumpTo(id);
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [jumpTo]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 2_000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    const update = () => {
      if (!followScroll.current) return;
      const cards = [...document.querySelectorAll<HTMLElement>("[data-help-section]")].filter((card) => card.offsetParent !== null);
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const current = atBottom ? cards.at(-1) : cards.find((card) => card.getBoundingClientRect().bottom > READING_LINE);
      setActiveId(current?.id ?? null);
    };
    const release = () => { followScroll.current = true; };
    const userInputs = ["wheel", "keydown", "touchstart", "mousedown"] as const;
    update();
    window.addEventListener("scroll", update, { passive: true });
    for (const type of userInputs) window.addEventListener(type, release, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      for (const type of userInputs) window.removeEventListener(type, release);
    };
  }, [keyword, adminCollapsed]);

  const onTocClick = (id: string) => {
    window.history.replaceState(null, "", `#${id}`);
    jumpTo(id);
  };
  const backToToc = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.querySelector<HTMLElement>("nav[aria-label='目次'] a")?.focus({ preventScroll: true });
  };

  return <div className="min-h-screen bg-[#f4f7fb] text-slate-900 print:bg-white">
    {/* contents にして囲み自体の箱をなくし、ヘッダーをほかの画面と同じく画面の上に固定する。印刷では隠す。 */}
    <div className="contents print:hidden"><AppHeader view="help" kiosk={kiosk} /></div>
    <main className="mx-auto max-w-[1400px] p-4 pb-24 md:p-8 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold text-blue-600">FleetFlow</p><h2 className="mt-1 text-2xl font-black">使い方</h2><p className="mt-1 text-sm text-slate-500">社用車の利用開始・予約・返却と、管理者の設定のしかたをまとめています。</p></div><Button variant="ghost" className="print:hidden" onClick={() => window.print()}><Printer className="size-4" />印刷・PDFに保存</Button></div>
      <div className="relative mt-4 w-full sm:w-96 print:hidden"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input type="search" aria-label="使い方を検索" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }} placeholder="説明を検索（例：取り消し、残量）" className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-blue-500" /></div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr] print:block">
        <nav aria-label="目次" className="print:hidden"><div className="space-y-4 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">{userSections.length > 0 ? <TocGroup title="利用する人" sections={userSections} activeId={activeId} onJump={onTocClick} /> : null}{adminGroups.length > 0 ? <div><p className="px-3 text-xs font-black text-slate-500">管理者</p><div className="mt-1 space-y-2">{adminGroups.map((group) => <TocGroup key={group.title} title={group.title} sections={group.sections} activeId={activeId} onJump={onTocClick} sub />)}</div></div> : null}</div></nav>
        <div className="space-y-8">
          {empty ? <p role="status" className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">当てはまる説明はありません。別の言葉で探してください。</p> : null}
          {userSections.length > 0 ? <SectionGroup title="利用する人" sections={userSections} flashId={flash?.id} pattern={pattern} /> : null}
          {adminGroups.length > 0 ? <section aria-label="管理者" className="space-y-6 print:break-before-page"><h2 className="flex items-baseline gap-2 border-b-2 border-slate-900 pb-2 text-lg font-black">管理者<span className="text-xs font-bold text-slate-500">やりたいことから探してください。</span></h2>
            {adminCollapsed ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-slate-300 bg-white p-4 print:hidden"><p className="text-sm text-slate-600">共用端末では、管理者向けの説明を閉じています。</p><Button variant="secondary" onClick={() => setAdminOpen(true)}>管理者向けの説明を開く</Button></div> : null}
            <div className={cn("space-y-6", adminCollapsed && "hidden print:block")}>{adminGroups.map((group) => <SectionGroup key={group.title} title={group.title} sections={group.sections} flashId={flash?.id} pattern={pattern} sub />)}</div>
          </section> : null}
          {!empty ? <div className="flex justify-end print:hidden"><Button variant="ghost" onClick={backToToc}><ArrowUp className="size-4" />目次へ戻る</Button></div> : null}
        </div>
      </div>
    </main>
    <Navigation view="help" className="fixed inset-x-3 bottom-3 z-40 flex rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur lg:hidden print:hidden" />
    <style jsx global>{`
      @media print {
        @page { size: A4 portrait; margin: 12mm; }
        .help-figure { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    `}</style>
  </div>;
}

function TocGroup({ title, sections, activeId, onJump, sub = false }: { title: string; sections: Section[]; activeId: string | null; onJump: (id: string) => void; sub?: boolean }) {
  return <div><p className={sub ? "px-3 text-[11px] font-bold text-slate-400" : "px-3 text-xs font-black text-slate-500"}>{title}</p><ul className="mt-0.5">{sections.map((section) => <li key={section.id}><a href={`#${section.id}`} aria-current={activeId === section.id ? "location" : undefined} onClick={(event) => { event.preventDefault(); onJump(section.id); }} className={cn("flex items-center rounded-lg px-3 text-sm font-bold", sub ? "min-h-8" : "min-h-9", activeId === section.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:bg-white hover:text-blue-700")}>{section.title}</a></li>)}</ul></div>;
}

function SectionGroup({ title, sections, flashId, pattern, sub = false }: { title: string; sections: Section[]; flashId?: string; pattern: RegExp | null; sub?: boolean }) {
  const Heading = sub ? "h3" : "h2";
  return <section aria-label={title}><Heading className={sub ? "text-sm font-black text-slate-500 print:break-after-avoid" : "border-b-2 border-slate-900 pb-2 text-lg font-black"}>{title}</Heading><div className={cn("grid gap-4 xl:grid-cols-2 print:block print:space-y-3", sub ? "mt-2" : "mt-4")}>{sections.map((section) => <GuideCard key={section.id} section={section} heading={sub ? "h4" : "h3"} flash={flashId === section.id} pattern={pattern} />)}</div></section>;
}

function GuideCard({ section, heading: Heading, flash, pattern }: { section: Section; heading: "h3" | "h4"; flash: boolean; pattern: RegExp | null }) {
  return <Card id={section.id} data-help-section="" className={cn("scroll-mt-24 p-5 transition-shadow duration-500 print:break-inside-avoid print:rounded-none print:border-0 print:border-b print:p-0 print:pb-3 print:shadow-none", section.wide && "xl:col-span-2", flash && "ring-4 ring-blue-300")}>
    <Heading className="flex items-center gap-2 text-base font-black"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700 print:size-6 print:bg-transparent">{section.icon}</span>{highlight(section.title, pattern)}</Heading>
    {section.intro ? <p className="mt-3 text-sm text-slate-700">{withLabels(section.intro, pattern)}</p> : null}
    {section.steps ? <ol className="mt-3 space-y-2">{section.steps.map((step, index) => <li key={index} className="flex gap-3 text-sm leading-relaxed"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-black text-white print:border print:border-slate-900 print:bg-white print:text-slate-900">{index + 1}</span><span className="pt-0.5">{withLabels(step, pattern)}</span></li>)}</ol> : null}
    {section.notes ? <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-slate-700">{section.notes.map((note, index) => <li key={index} className="flex gap-2"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-400" /><span>{withLabels(note, pattern)}</span></li>)}</ul> : null}
    {section.figure}
  </Card>;
}
