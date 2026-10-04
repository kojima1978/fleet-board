"use client";

import { useEffect, useState } from "react";
import { CarFront, KeyRound, LoaderCircle, LogOut } from "lucide-react";
import { Button, Card } from "./ui";

export function AdminGate({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/session", { cache: "no-store", signal: controller.signal }).then((response) => response.json()).then((result) => setAuthenticated(result.authenticated === true)).catch(() => setAuthenticated(false));
    return () => controller.abort();
  }, []);
  const login = async (event: React.FormEvent) => {
    event.preventDefault(); setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
      const result = await response.json();
      if (!response.ok) { setError(result.message ?? "認証できませんでした"); return; }
      setPin(""); setAuthenticated(true);
    } catch { setError("サーバーへ接続できませんでした"); }
    finally { setSubmitting(false); }
  };
  const logout = async () => { await fetch("/api/admin/session", { method: "DELETE" }).catch(() => undefined); setAuthenticated(false); };
  if (authenticated === null) return <div className="grid min-h-screen place-items-center bg-[#f4f7fb]"><LoaderCircle className="size-8 animate-spin text-blue-600" /></div>;
  if (!authenticated) return <div className="grid min-h-screen place-items-center bg-[#f4f7fb] p-4"><Card className="w-full max-w-md p-6"><div className="flex items-center gap-3"><span className="grid size-12 place-items-center rounded-2xl bg-blue-600 text-white"><CarFront /></span><div><h1 className="text-xl font-black">管理設定</h1><p className="text-sm text-slate-500">社員・車両情報を保護しています</p></div></div><form className="mt-6 space-y-4" onSubmit={login}><label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">管理者PIN</span><div className="relative"><KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input autoFocus required inputMode="numeric" pattern="[0-9]*" minLength={4} maxLength={12} type="password" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} className="min-h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-lg tracking-[0.35em] outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50" /></div></label>{error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p> : null}<Button type="submit" disabled={submitting || pin.length < 4} className="min-h-12 w-full">{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}{submitting ? "確認中…" : "設定画面を開く"}</Button></form><p className="mt-4 text-center text-xs text-slate-400">認証は8時間有効です</p></Card></div>;
  return <>{children}<button type="button" onClick={logout} className="fixed bottom-24 left-4 z-50 inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 text-xs font-bold text-slate-600 shadow-lg backdrop-blur hover:bg-slate-50 md:bottom-4"><LogOut className="size-4" />管理者モード終了</button></>;
}
