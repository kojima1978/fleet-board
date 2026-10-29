"use client";

import { useId, useRef, useState } from "react";
import { Check, Delete, Keyboard } from "lucide-react";
import type { Employee } from "@/lib/types";

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ja").replace(/\s+/g, "");
export function findEmployees(employees: Employee[], query: string, numberOnly = false) {
  const keyword = normalize(query);
  return employees.filter((person) => person.active && (!keyword || (numberOnly ? normalize(person.code).replace(/^e/, "").includes(keyword) : [person.code, person.name, person.department].some((value) => normalize(value).includes(keyword)))))
    .sort((left, right) => left.code.localeCompare(right.code, "ja", { numeric: true }));
}

export function EmployeePicker({ employees, onSelect, currentId, keypadInitiallyOpen = false, disabled = false }: { employees: Employee[]; onSelect: (person: Employee) => void; currentId?: string | null; keypadInitiallyOpen?: boolean; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const [keypad, setKeypad] = useState(keypadInitiallyOpen);
  const [limit, setLimit] = useState(20);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const filtered = findEmployees(employees, query, keypad);
  const update = (value: string) => { setQuery(value); setLimit(20); };
  const openKeypad = () => { update(normalize(query).replace(/^e/, "").replace(/\D/g, "")); setKeypad(true); input.current?.blur(); };
  return <fieldset disabled={disabled} className="min-w-0 space-y-3 disabled:opacity-60">
    <legend className="sr-only">利用者を検索して選択</legend>
    <label htmlFor={id} className="block text-xs font-bold text-slate-700">{keypad ? "社員番号を入力" : "社員番号または氏名を入力"}</label>
    <div className="flex gap-2"><input ref={input} id={id} type="search" inputMode={keypad ? "none" : "text"} autoComplete="off" maxLength={100} value={query} onChange={(event) => update(keypad ? normalize(event.target.value).replace(/\D/g, "") : event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} placeholder={keypad ? "例：001（Eは入力不要）" : "例：E001・001・山田"} className="min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />{!keypad ? <button type="button" aria-expanded={false} onClick={openKeypad} className="flex min-h-12 shrink-0 items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-800"><Keyboard className="size-4" />テンキー</button> : null}</div>
    {keypad ? <div className="rounded-xl border border-slate-200 bg-slate-50 p-2"><div role="group" aria-label="社員番号テンキー" className="grid grid-cols-3 gap-2">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "クリア", "0", "1文字消す"].map((key) => <button key={key} type="button" aria-label={key} disabled={disabled || ((key === "クリア" || key === "1文字消す") && !query)} onClick={() => update(key === "クリア" ? "" : key === "1文字消す" ? query.slice(0, -1) : (query + key).slice(0, 100))} className="flex min-h-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-lg font-bold text-slate-800 active:bg-blue-100 disabled:opacity-40">{key === "1文字消す" ? <Delete className="size-5" /> : key === "クリア" ? <span className="text-xs">クリア</span> : key}</button>)}</div><button type="button" onClick={() => { setKeypad(false); setLimit(20); input.current?.focus(); }} className="mt-2 min-h-11 w-full rounded-lg text-xs font-bold text-blue-700 hover:bg-blue-50">テンキーを閉じる・氏名で探す</button></div> : null}
    <p role="status" aria-live="polite" className="text-xs text-slate-500">{filtered.length}人の候補{filtered.length > limit ? `（${limit}人を表示）` : ""} ・ 名前をタップして確定</p>
    <ul aria-label="利用者の検索候補" className="max-h-64 space-y-2 overflow-y-auto pr-1">{filtered.slice(0, limit).map((person) => <li key={person.id}><button type="button" onClick={() => onSelect(person)} aria-current={currentId === person.id ? "true" : undefined} className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left ${currentId === person.id ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50"}`}><span className="shrink-0 font-mono text-xs text-slate-600">{person.code}</span><span className="min-w-0 flex-1"><span className="block break-words text-sm font-bold text-slate-900">{person.name}</span><span className="block break-words text-xs text-slate-500">{person.department}</span></span>{currentId === person.id ? <Check aria-label="選択中" className="size-4 shrink-0 text-emerald-700" /> : null}</button></li>)}</ul>
    {filtered.length > limit ? <button type="button" onClick={() => setLimit((count) => count + 20)} className="min-h-12 w-full rounded-xl border border-slate-200 bg-white text-sm font-bold text-blue-700">さらに20人表示</button> : null}
    {!filtered.length ? <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-600">該当する社員がいません。番号や氏名を確認してください。</p> : null}
  </fieldset>;
}
