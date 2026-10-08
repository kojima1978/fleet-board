"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("FleetFlow画面エラー", { message: error.message, digest: error.digest });
  }, [error]);

  return <main className="grid min-h-screen place-items-center bg-[#f4f7fb] p-4"><section role="alert" className="w-full max-w-lg rounded-3xl border border-rose-200 bg-white p-7 text-center shadow-xl"><span className="mx-auto grid size-14 place-items-center rounded-full bg-rose-50 text-rose-700"><AlertTriangle className="size-7" /></span><h1 className="mt-4 text-xl font-black text-slate-900">画面を正常に表示できませんでした</h1><p className="mt-2 text-sm leading-6 text-slate-600">登録処理をもう一度実行せず、最初に画面を再読み込みしてください。保存済みのデータは失われません。</p>{error.digest ? <p className="mt-2 text-[11px] text-slate-400">確認番号：{error.digest}</p> : null}<div className="mt-6 grid gap-2 sm:grid-cols-2"><button type="button" onClick={reset} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700"><RefreshCw className="size-4" />画面を再読み込み</button><Link href="/" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">駐車場へ戻る</Link></div></section></main>;
}
