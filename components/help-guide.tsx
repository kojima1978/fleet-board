"use client";

import type { ReactNode } from "react";
import { AlertTriangle, CalendarClock, CarFront, Clock3, Database, LayoutGrid, LifeBuoy, MapPin, Printer, Undo2, Users, Volume2, Wrench } from "lucide-react";
import { isKioskDevice, useDeviceMode } from "@/lib/device-mode";
import { useNfcBridgeHealth, useQrBridgeHealth } from "@/lib/use-nfc-bridge";
import { AppHeader, Navigation } from "./app-header";
import { Button, Card } from "./ui";

type Section = { id: string; title: string; icon: ReactNode; intro?: string; steps?: ReactNode[]; notes?: ReactNode[] };

// 画面のボタン名は「」で囲み、実際の表示と同じ言葉にする。画面を変えたらここも合わせて直す。
const USER_SECTIONS: Section[] = [
  { id: "screens", title: "画面の見方", icon: <LayoutGrid className="size-5" />, intro: "上のメニューで画面を切り替えます。", notes: [
    <><b>駐車場</b>：配置図で車の場所・ガソリン残量・利用中の車を確認し、利用開始と返却をします。</>,
    <><b>タイムライン</b>：車ごとの予約・利用の予定を確認し、予約をします。</>,
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
  ] },
  { id: "reserve", title: "予約する", icon: <CalendarClock className="size-5" />, steps: [
    <>配置図で車を押して「予約する」を押します。タイムラインの左の車両名を押しても開けます。</>,
    <>「時間で予約」「1日利用」（6:00〜22:00）「日をまたいで利用」（最大7日）から選び、日時を指定します。</>,
    <>「この内容で予約」を押します。</>,
    <>予約の時刻になったら、配置図でその車を押し、「今すぐ利用」から「予約した車両を利用開始」を押します。</>,
  ], notes: [
    <>予約の時刻になっても、自動では利用中になりません。必ず利用開始の操作をしてください。</>,
    <>開始予定から30分たっても利用開始しない予約は、自動で取り消されます。</>,
    <>予約を変えるときは、タイムラインの予約の帯か予約一覧を押し、「変更内容を確認」→「この内容で予約を変更」と進みます。</>,
    <>使わなくなった予約は、同じ画面の下の赤い「この予約を取り消す」で取り消します。</>,
  ] },
  { id: "extend", title: "延長する", icon: <Clock3 className="size-5" />, steps: [
    <>配置図の右の「利用中」か、配置図で自分の車を押します。</>,
    <>「30分」「1時間」「2時間」「3時間」「終日」から延ばす時間を選びます。「変更後」に延長後の時刻が出ます。</>,
    <>「延長する」を押します。</>,
  ], notes: [
    <>次の予約や車検の予定と重なる時間には延長できません。</>,
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
  ] },
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

const ADMIN_SECTIONS: Section[] = [
  { id: "employees", title: "社員・部署を登録する", icon: <Users className="size-5" />, steps: [
    <>「設定 → 部署」で部署を追加します。上下のボタンで並び順を変えられます。</>,
    <>「設定 → 社員登録」で社員を追加します。社員番号は英字1文字と数字3桁です（例：E001）。</>,
    <>社員証を使うときは「NFC登録」を押し、社員証をかざします。社員QRは一覧の「QR」から表示・保存・メール送信できます。</>,
  ], notes: [
    <>まとめて登録するときは「JSON取込」を使います。「ひな形を保存」で形式を確認できます。</>,
    <>退職・異動した人は、編集画面の「利用停止」で選択肢から外します。履歴は残ります。</>,
    <>社員QRを無くした・誤って送ったときは、QR画面の「紛失・破損のため再発行」で古いQRを使えなくします。</>,
    <>持ち主の分からないカードは、一覧の上の「NFCを確認」で調べられます。</>,
  ] },
  { id: "vehicles", title: "車両を登録する", icon: <CarFront className="size-5" />, steps: [
    <>「設定 → 車両登録」で車両を追加します。車両番号は英字1文字と数字3桁です（例：C001）。</>,
    <>停める駐車区画を選びます。場所が決まっていなければ仮置きの区画を選びます。</>,
    <>表示色・車種（普通車・軽自動車）・装備・ガソリンカードの名前を登録します。</>,
    <>車両タグを使うときは「NFC登録」を押してタグをかざします。車両QRは一覧の「QR」から表示・保存できます。</>,
  ], notes: [
    <>ガソリンカードは番号ではなく、「出光 末尾1234」のように見分けられる名前だけを登録します。</>,
    <>廃車などで使わなくなった車は、編集画面の「利用停止」で外します。</>,
  ] },
  { id: "maintenance", title: "車検・整備で使えないとき", icon: <Wrench className="size-5" />, intro: "「設定 → 車両登録」の「整備」から登録します。", notes: [
    <><b>故障（駐車場内）</b>：車は区画に置いたまま、利用だけを止めます。</>,
    <><b>車検・修理で外出</b>：区画を空けるので、その間ほかの車を停められます。</>,
    <>「予定を登録」すると、その期間は予約できなくなります。予定は自動では始まりません。出すときに、配置図で車を押して「車検を開始」を押します。</>,
    <>戻ったら、配置図の右の「車検中」の車を押して「車検を終了」を押し、停める区画を選びます。</>,
  ] },
  { id: "spots", title: "駐車区画を設定する", icon: <MapPin className="size-5" />, intro: "「設定 → 駐車区画」で配置図の区画を押して変更します。", notes: [
    <><b>用途</b>：通常・一時・お客様用・専用（指定した1台だけ）・仮置き（実在しない区画）から選びます。</>,
    <><b>表示名</b>：配置図で番号の横に出す名前です。「自動」か「任意」（10文字以内）を選びます。</>,
    <><b>手前の区画</b>：ここに車があると出し入れできない区画を選びます。選んだ区画に車があると、利用開始・返却のときに注意を出します。「初期設定に戻す」で元に戻せます。</>,
  ] },
  { id: "guidance", title: "案内と音声を設定する", icon: <Volume2 className="size-5" />, intro: "「設定 → 案内設定」で、画面に出すメッセージと音声を変えられます。", notes: [
    <><b>駐車案内</b>：出庫・区画選び・入庫・出庫できない・入庫できないときの読み上げを、項目ごとに設定します。</>,
    <><b>ガソリン案内</b>：「利用開始時」「返却時」ごとに、残量別のメッセージ・表示方法・音声を設定します。給油してくれた人への「給油時のお礼」もここで設定します。</>,
    <>音声ファイルはMP3・WAV（2MBまで）です。ドラッグ＆ドロップで登録し、「試聴」で確認できます。</>,
    <>「初期設定に戻す」で、文面と音声を最初の状態に戻せます。</>,
    <>端末ごとの音のオン・オフは、右上の「共用端末」「各自のPC」の表示を押して「音声・効果音」で切り替えます。</>,
  ] },
  { id: "data", title: "データを保存・復元する", icon: <Database className="size-5" />, intro: "「設定 → データ保存・復元」で、全データを1つのJSONファイルに書き出せます。", notes: [
    <>JSONには個人情報や社員証の番号が入っています。安全な場所に保存してください。</>,
    <>復元すると、今のデータがすべて置き換わります。確認欄に「RESTORE」と入力してから実行します。</>,
    <>自動のバックアップとは別のものです。自動バックアップも止めずに使ってください。</>,
  ] },
  { id: "emergency", title: "システムが使えないとき", icon: <AlertTriangle className="size-5" />, notes: [
    <>「設定 → 緊急時」から、空の駐車場配置図とタイムラインを印刷できます。システムが止まっている間は、紙に記録してください。</>,
    <>「設定 → システム」で、アプリ・データベース・バックアップ・NFC・QRの状態を確認できます。</>,
    <>社員証・車両タグの読み取りが直らないときは、「設定 → NFC・QR」の「NFC・QRを再接続」を試してください。</>,
  ] },
];

export function HelpGuide() {
  const nfcHealth = useNfcBridgeHealth(true);
  const qrHealth = useQrBridgeHealth(true);
  const kiosk = isKioskDevice(useDeviceMode(), nfcHealth === "ready" || qrHealth === "ready" ? "ready" : nfcHealth);
  return <div className="min-h-screen bg-[#f4f7fb] text-slate-900 print:bg-white">
    <div className="print:hidden"><AppHeader view="help" kiosk={kiosk} /></div>
    <main className="mx-auto max-w-[1400px] p-4 pb-24 md:p-8 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold text-blue-600">FleetFlow</p><h2 className="mt-1 text-2xl font-black">使い方</h2><p className="mt-1 text-sm text-slate-500">社用車の利用開始・予約・返却と、管理者の設定のしかたをまとめています。</p></div><Button variant="ghost" className="print:hidden" onClick={() => window.print()}><Printer className="size-4" />印刷・PDFに保存</Button></div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr] print:block">
        <nav aria-label="目次" className="print:hidden"><div className="space-y-4 lg:sticky lg:top-24"><TocGroup title="利用する人" sections={USER_SECTIONS} /><TocGroup title="管理者" sections={ADMIN_SECTIONS} /></div></nav>
        <div className="space-y-8">
          <SectionGroup title="利用する人" sections={USER_SECTIONS} />
          <SectionGroup title="管理者" note="設定画面の操作です。" sections={ADMIN_SECTIONS} breakBefore />
        </div>
      </div>
    </main>
    <Navigation view="help" className="fixed inset-x-3 bottom-3 z-40 flex rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur lg:hidden print:hidden" />
    <style jsx global>{`
      @media print {
        @page { size: A4 portrait; margin: 12mm; }
      }
    `}</style>
  </div>;
}

function TocGroup({ title, sections }: { title: string; sections: Section[] }) {
  return <div><p className="px-3 text-xs font-black text-slate-500">{title}</p><ul className="mt-1">{sections.map((section) => <li key={section.id}><a href={`#${section.id}`} className="flex min-h-9 items-center rounded-lg px-3 text-sm font-bold text-slate-600 hover:bg-white hover:text-blue-700">{section.title}</a></li>)}</ul></div>;
}

function SectionGroup({ title, note, sections, breakBefore = false }: { title: string; note?: string; sections: Section[]; breakBefore?: boolean }) {
  return <section aria-label={title} className={breakBefore ? "print:break-before-page" : undefined}><h2 className="flex items-baseline gap-2 border-b-2 border-slate-900 pb-2 text-lg font-black">{title}{note ? <span className="text-xs font-bold text-slate-500">{note}</span> : null}</h2><div className="mt-4 grid gap-4 xl:grid-cols-2 print:block print:space-y-3">{sections.map((section) => <GuideCard key={section.id} section={section} />)}</div></section>;
}

function GuideCard({ section }: { section: Section }) {
  return <Card id={section.id} className="scroll-mt-24 p-5 print:break-inside-avoid print:rounded-none print:border-0 print:border-b print:p-0 print:pb-3 print:shadow-none">
    <h3 className="flex items-center gap-2 text-base font-black"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700 print:size-6 print:bg-transparent">{section.icon}</span>{section.title}</h3>
    {section.intro ? <p className="mt-3 text-sm text-slate-700">{section.intro}</p> : null}
    {section.steps ? <ol className="mt-3 space-y-2">{section.steps.map((step, index) => <li key={index} className="flex gap-3 text-sm leading-relaxed"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-black text-white print:border print:border-slate-900 print:bg-white print:text-slate-900">{index + 1}</span><span className="pt-0.5">{step}</span></li>)}</ol> : null}
    {section.notes ? <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-slate-700">{section.notes.map((note, index) => <li key={index} className="flex gap-2"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-400" /><span>{note}</span></li>)}</ul> : null}
  </Card>;
}
