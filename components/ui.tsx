import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

export function Button({ className, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const styles = { primary: "bg-blue-600 text-white hover:bg-blue-700", secondary: "bg-slate-900 text-white hover:bg-slate-800", ghost: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50", danger: "bg-rose-600 text-white hover:bg-rose-700" };
  return <button className={cn("inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition disabled:pointer-events-none disabled:opacity-40", styles[variant], className)} {...props} />;
}

// ダイアログ下の操作欄。どの画面も左にキャンセル、右に確定（大きな青いボタン）を置く。wideでは確定を右寄せにして横に伸ばしすぎない。
export function DialogActions({ onCancel, cancelLabel = "キャンセル", cancelDisabled, note, wide = false, children }: { onCancel: () => void; cancelLabel?: string; cancelDisabled?: boolean; note?: React.ReactNode; wide?: boolean; children: React.ReactNode }) {
  return <div role="group" aria-label="操作" className="space-y-2"><div className={cn("grid grid-cols-[auto_1fr] gap-2", wide && "sm:flex sm:justify-end")}><Button type="button" variant="ghost" className="min-h-12 whitespace-nowrap px-5" disabled={cancelDisabled} onClick={onCancel}>{cancelLabel}</Button>{children}</div>{note ? <p className="text-center text-[11px] text-slate-400">{note}</p> : null}</div>;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-slate-200 bg-white shadow-sm", className)} {...props} />;
}
