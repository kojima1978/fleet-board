"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronUp, Pencil, Plus, Power, X } from "lucide-react";
import type { DashboardData, Department } from "@/lib/types";
import { Button, Card, cn } from "./ui";

type Mutate = (body: object, success: string) => Promise<boolean>;

const field = "min-h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-50";
// APIと同じく、空白の違いだけの部署名は同じものとして扱う。
const normalizeName = (value: string) => value.trim().replace(/\s+/g, " ");

// 社員が所属する部署の追加・名前変更・利用停止・並び順を管理する画面。部署は10件程度を想定し、全件を1画面に並べる。
export function DepartmentSettings({ data, mutate }: { data: DashboardData; mutate: Mutate }) {
  const [newName, setNewName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const active = data.departments.filter((department) => department.active);
  const stopped = data.departments.filter((department) => !department.active);
  const normalizedNewName = normalizeName(newName);
  const duplicate = data.departments.find((department) => department.name === normalizedNewName);

  const run = async (id: string, body: object, success: string) => {
    if (busyId) return false;
    setBusyId(id);
    try { return await mutate(body, success); }
    finally { setBusyId(null); }
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!normalizedNewName || duplicate) return;
    if (await run("new", { action: "createDepartment", name: normalizedNewName }, `部署「${normalizedNewName}」を追加しました`)) setNewName("");
  };

  return <div className="max-w-3xl space-y-3">
    <Card className="p-4">
      <form onSubmit={create} className="flex flex-wrap items-start gap-2">
        <label className="min-w-0 flex-1 basis-64">
          <span className="text-xs font-bold text-slate-600">部署を追加</span>
          <input value={newName} maxLength={50} onChange={(event) => setNewName(event.target.value)} placeholder="例：営業部" className={cn(field, "mt-1", duplicate && "border-rose-300")} aria-invalid={!!duplicate} />
          {duplicate ? <span className="mt-1 block text-xs font-bold text-rose-600">{duplicate.active ? "同じ名前の部署が登録済みです" : "同じ名前の部署が利用停止中です。下の一覧から利用を再開してください"}</span> : <span className="mt-1 block text-xs text-slate-500">社員の登録・編集では、ここで追加した部署から選びます。</span>}
        </label>
        <Button type="submit" className="mt-5 min-h-10" disabled={!normalizedNewName || !!duplicate || busyId !== null}><Plus className="size-4" />追加</Button>
      </form>
    </Card>

    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5"><h3 className="text-sm font-black">利用中の部署</h3><span className="text-xs text-slate-500">{active.length}件 ・ この順に社員画面の選択肢へ並びます</span></div>
      {active.length === 0 ? <p className="p-8 text-center text-sm text-slate-400">部署がまだありません。上の欄から追加してください</p> : <ol className="divide-y divide-slate-100">
        {active.map((department, index) => <DepartmentRow key={department.id} department={department} departments={data.departments} first={index === 0} last={index === active.length - 1} busy={busyId !== null} editing={editingId === department.id} onEdit={(editing) => setEditingId(editing ? department.id : null)} run={run} />)}
      </ol>}
    </Card>

    {stopped.length ? <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5"><h3 className="text-sm font-black text-slate-500">利用停止中の部署</h3><span className="text-xs text-slate-500">{stopped.length}件 ・ 社員の選択肢には出ません</span></div>
      <ul className="divide-y divide-slate-100">
        {stopped.map((department) => <li key={department.id} className="flex items-center gap-3 px-4 py-2.5">
          <p className="min-w-0 flex-1 truncate text-sm font-bold text-slate-500">{department.name}</p>
          <button type="button" disabled={busyId !== null} onClick={() => void run(department.id, { action: "setDepartmentActive", id: department.id, version: department.version, active: true }, `部署「${department.name}」の利用を再開しました`)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-emerald-200 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"><Power className="size-3.5" />利用再開</button>
        </li>)}
      </ul>
    </Card> : null}
  </div>;
}

function DepartmentRow({ department, departments, first, last, busy, editing, onEdit, run }: { department: Department; departments: Department[]; first: boolean; last: boolean; busy: boolean; editing: boolean; onEdit: (editing: boolean) => void; run: (id: string, body: object, success: string) => Promise<boolean> }) {
  const [name, setName] = useState(department.name);
  const normalized = normalizeName(name);
  const duplicate = normalized !== department.name && departments.some((item) => item.name === normalized);
  const canSave = !!normalized && normalized !== department.name && !duplicate;
  const move = (direction: "up" | "down") => void run(department.id, { action: "moveDepartment", id: department.id, direction }, `部署「${department.name}」を${direction === "up" ? "上" : "下"}へ移動しました`);
  const startEdit = () => { setName(department.name); onEdit(true); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    if (await run(department.id, { action: "renameDepartment", id: department.id, version: department.version, name: normalized }, `部署名を「${department.name}」から「${normalized}」へ変更しました`)) onEdit(false);
  };
  const members = department.employeeCount;

  return <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
    <span className="flex shrink-0 flex-col">
      <button type="button" aria-label={`${department.name}を上へ移動`} disabled={first || busy || editing} onClick={() => move("up")} className="grid h-5 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-25"><ChevronUp className="size-4" /></button>
      <button type="button" aria-label={`${department.name}を下へ移動`} disabled={last || busy || editing} onClick={() => move("down")} className="grid h-5 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-25"><ChevronDown className="size-4" /></button>
    </span>
    {editing ? <form onSubmit={save} className="flex min-w-0 flex-1 basis-64 flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1 basis-48">
        <input autoFocus aria-label={`${department.name}の新しい部署名`} value={name} maxLength={50} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onEdit(false); }} className={cn(field, duplicate && "border-rose-300")} aria-invalid={duplicate} />
        <p className={cn("mt-1 text-xs", duplicate ? "font-bold text-rose-600" : "text-slate-500")}>{duplicate ? "同じ名前の部署が登録済みです" : members ? `所属する社員${members}人の部署名も変わります` : "所属している有効な社員はいません"}</p>
      </div>
      <span className="flex gap-1 self-start">
        <button type="submit" disabled={!canSave || busy} className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"><Check className="size-3.5" />保存</button>
        <button type="button" onClick={() => onEdit(false)} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"><X className="size-3.5" />取消</button>
      </span>
    </form> : <>
      <p className="min-w-0 flex-1 truncate text-sm font-black">{department.name}</p>
      <Link href={`/settings/employees?department=${encodeURIComponent(department.name)}`} className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-700" aria-label={`${department.name}の社員${members}人を表示`}>社員 {members}人</Link>
      <span className="flex shrink-0 gap-1">
        <button type="button" disabled={busy} onClick={startEdit} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"><Pencil className="size-3.5" />名前を変更</button>
        <button type="button" disabled={busy || members > 0} title={members > 0 ? "有効な社員が所属しているため停止できません" : undefined} onClick={() => void run(department.id, { action: "setDepartmentActive", id: department.id, version: department.version, active: false }, `部署「${department.name}」の利用を停止しました`)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-transparent"><Power className="size-3.5" />利用停止</button>
      </span>
    </>}
  </li>;
}
