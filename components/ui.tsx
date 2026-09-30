import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

export function Button({ className, variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const styles = { primary: "bg-blue-600 text-white hover:bg-blue-700", secondary: "bg-slate-900 text-white hover:bg-slate-800", ghost: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50", danger: "bg-rose-600 text-white hover:bg-rose-700" };
  return <button className={cn("inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition disabled:pointer-events-none disabled:opacity-40", styles[variant], className)} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-slate-200 bg-white shadow-sm", className)} {...props} />;
}
