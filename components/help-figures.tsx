import { Fragment, type ReactNode } from "react";
import { ArrowDown, CarFront, ChevronRight } from "lucide-react";
import { cn } from "./ui";

// 「使い方」ページの図。画面写真ではなく、画面の部品を簡単に描く。ボタン名は実際の表示と同じにする。

function Figure({ caption, children }: { caption: string; children: ReactNode }) {
  return <figure className="help-figure mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 print:break-inside-avoid">
    {children}
    <figcaption className="mt-3 text-xs font-bold text-slate-500">{caption}</figcaption>
  </figure>;
}

function Mark({ n }: { n: number }) {
  return <span aria-label={`${n}番`} className="inline-grid size-5 shrink-0 place-items-center rounded-full bg-amber-500 text-[11px] font-black text-white">{n}</span>;
}

function Chip({ children, primary = false, active = false }: { children: ReactNode; primary?: boolean; active?: boolean }) {
  return <span className={cn("inline-flex h-7 items-center whitespace-nowrap rounded-lg border px-2 text-[11px] font-bold", primary ? "border-blue-600 bg-blue-600 text-white" : active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600")}>{children}</span>;
}

const SETTINGS_TABS = ["車両登録", "社員登録", "部署", "駐車区画", "案内設定", "システム", "NFC・QR", "データ保存・復元", "緊急時"];

export function SettingsScreenFigure() {
  return <Figure caption="設定画面のつくり（社員登録の例。車両登録も同じ並びです）">
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2"><Mark n={1} /><div className="flex flex-wrap gap-1">{SETTINGS_TABS.map((tab) => <Chip key={tab} active={tab === "社員登録"}>{tab}</Chip>)}</div></div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3"><span className="h-7 min-w-40 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 text-[11px] leading-7 text-slate-400">社員番号・氏名などで検索</span><Chip>有効</Chip><Chip>NFCを確認</Chip><Chip>JSON取込</Chip><span className="flex items-center gap-1.5"><Mark n={2} /><Chip primary>社員を追加</Chip></span></div>
      <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 text-[11px]">
        <div className="grid grid-cols-[4rem_1fr_5rem_auto] gap-2 bg-slate-50 px-2 py-1.5 font-bold text-slate-500"><span>社員番号</span><span>氏名</span><span>部署</span><span>操作</span></div>
        {[["E001", "山田 太郎", "営業部", "NFC変更"], ["E002", "鈴木 花子", "総務部", "NFC登録"]].map(([code, name, department, nfc], index) => <div key={code} className="grid grid-cols-[4rem_1fr_5rem_auto] items-center gap-2 border-t border-slate-100 px-2 py-1.5"><span className="font-bold">{code}</span><span>{name}</span><span className="text-slate-500">{department}</span><span className="flex items-center gap-1">{index === 0 ? <Mark n={3} /> : <span className="w-5" />}<Chip>QR</Chip><Chip>{nfc}</Chip><Chip>編集</Chip></span></div>)}
      </div>
    </div>
    <ol className="mt-3 grid gap-1.5 text-xs text-slate-700 md:grid-cols-3">
      <li className="flex gap-2"><Mark n={1} />上のタブで、設定する項目を切り替えます。</li>
      <li className="flex gap-2"><Mark n={2} />新しく登録するときは、右上の「社員を追加」「車両を追加」を押します。</li>
      <li className="flex gap-2"><Mark n={3} />登録済みのものを直すときは、その行の右のボタンを押します。</li>
    </ol>
  </Figure>;
}

type FlowStep = { where?: string; label: ReactNode; tone?: "default" | "state" | "done" };

function FlowRow({ title, steps }: { title?: string; steps: FlowStep[] }) {
  return <div>
    {title ? <p className="mb-1.5 text-xs font-black text-slate-700">{title}</p> : null}
    <ol className="flex flex-wrap items-stretch gap-1.5">{steps.map((step, index) => <Fragment key={index}>
      {index > 0 ? <li aria-hidden className="grid place-items-center text-slate-400"><ChevronRight className="size-4" /></li> : null}
      <li className={cn("flex min-w-0 flex-col justify-center rounded-xl border px-3 py-2", step.tone === "state" ? "border-dashed border-amber-300 bg-amber-50" : step.tone === "done" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white")}>
        {step.where ? <span className="text-[10px] font-bold text-slate-500">{step.where}</span> : null}
        <span className="text-xs font-black text-slate-800">{step.label}</span>
      </li>
    </Fragment>)}</ol>
  </div>;
}

export function MaintenanceFlowFigure() {
  return <Figure caption="黄色の点線は車の状態です。ボタンを押さないと次の状態へは進みません。">
    <div className="space-y-4">
      <FlowRow title="車検・修理で外出（予定を登録する場合）" steps={[
        { where: "設定 → 車両登録", label: "「車検・故障」→「予定を登録」" },
        { where: "当日・駐車場", label: "車を押して「車検を開始」" },
        { label: "車検中（区画は空く）", tone: "state" },
        { where: "駐車場の右「車検中」", label: "車を押して「車検を終了」" },
        { where: "配置図", label: "区画と残量を選んで「区画◯◯に停めて終了」" },
        { label: "利用できる", tone: "done" },
      ]} />
      <FlowRow title="故障（駐車場内）" steps={[
        { where: "設定 → 車両登録", label: "「車検・故障」→「今すぐ」→「整備中にする」" },
        { label: "整備中（区画に置いたまま）", tone: "state" },
        { where: "駐車場", label: "車を押して「整備解除」→「整備を解除」" },
        { label: "利用できる", tone: "done" },
      ]} />
    </div>
  </Figure>;
}

export function RestoreFlowFigure() {
  return <Figure caption="「RESTORE」と入力するまでは、データは置き換わりません。">
    <div className="space-y-4">
      <FlowRow title="保存する" steps={[
        { where: "設定 → データ保存・復元", label: "「JSONで保存」" },
        { label: "JSONファイルを安全な場所に保管", tone: "done" },
      ]} />
      <FlowRow title="元に戻す" steps={[
        { where: "設定 → データ保存・復元", label: "JSONを枠へドラッグ＆ドロップ" },
        { label: "「復元できるファイルです」と件数を確認", tone: "state" },
        { label: "確認欄に「RESTORE」と入力" },
        { label: "「このJSONで全データを復元」" },
        { label: "全データが置き換わる", tone: "done" },
      ]} />
    </div>
  </Figure>;
}

export function FrontSpotFigure() {
  const column = (highlight: boolean) => <div className="flex flex-col items-center gap-1.5">
    <div className={cn("grid h-16 w-full place-items-center rounded-lg border-2 text-center text-[11px] font-black", highlight ? "border-blue-500 bg-blue-50 text-blue-800" : "border-slate-300 bg-white text-slate-400")}>{highlight ? <span>奥の区画<br /><span className="font-bold">（設定する区画）</span></span> : "奥"}</div>
    <ArrowDown aria-hidden className={cn("size-4", highlight ? "text-blue-500" : "text-transparent")} />
    <div className={cn("grid h-16 w-full place-items-center rounded-lg border-2 text-center text-[11px] font-black", highlight ? "border-amber-400 bg-amber-50 text-amber-800" : "border-slate-300 bg-white text-slate-400")}>{highlight ? <span className="flex flex-col items-center"><CarFront className="size-4" />手前の区画</span> : "手前"}</div>
    <ArrowDown aria-hidden className={cn("size-4", highlight ? "text-blue-500" : "text-transparent")} />
  </div>;
  return <Figure caption="奥の区画の車は、手前の区画を通って出入りします。手前に車があると出し入れできないので、注意を出します。">
    <div className="mx-auto max-w-md">
      <div className="grid grid-cols-3 gap-3">{column(false)}{column(true)}{column(false)}</div>
      <div className="rounded-lg bg-slate-300 py-2 text-center text-[11px] font-black tracking-widest text-slate-700">中央の道路（通路）</div>
    </div>
  </Figure>;
}

const SPOT_ROLES: { label: string; tile: string; text: string }[] = [
  { label: "通常", tile: "border-slate-300 bg-white", text: "社用車のいつもの駐車位置" },
  { label: "一時", tile: "border-sky-300 bg-sky-50", text: "通常の区画ではないが、一時的に返却できる" },
  { label: "お客様用", tile: "border-amber-300 bg-amber-50", text: "選ぶと注意を出し、別の区画をすすめる" },
  { label: "専用", tile: "border-violet-300 bg-violet-50", text: "指定した1台だけが停められる" },
  { label: "仮置き", tile: "border-zinc-400 bg-zinc-100", text: "実在しない区画。場所が決まらない車を一時的に置く" },
];

export function SpotRoleFigure() {
  return <Figure caption="配置図では、用途ごとにこの色で表示されます。">
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{SPOT_ROLES.map((role) => <li key={role.label} className="flex items-start gap-2 lg:flex-col">
      <span className={cn("grid h-10 w-14 shrink-0 place-items-center rounded-lg border-2 text-[11px] font-black text-slate-700", role.tile)}>{role.label}</span>
      <span className="text-xs text-slate-600">{role.text}</span>
    </li>)}</ul>
  </Figure>;
}
