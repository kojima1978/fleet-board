import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// 使い方ページで「」に入れたボタン名・見出しが、画面のソースに残っているかを確かめる。
// ボタン名を変えたときに、使い方の説明だけ古いまま残るのを防ぐ。
// 使い方の図（help-figures）は説明の一部なので、画面のソースには含めない。
const helpFiles = [join("components", "help-guide.tsx"), join("components", "help-figures.tsx")];
const sourceFiles = ["app", "components", "lib"].flatMap((dir) => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
  .map((entry) => join(entry.parentPath, entry.name))
  .filter((file) => !helpFiles.includes(file)));
const source = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");

// 画面の中で組み立てて表示する名前。ソースにそのままの文字列はない。
const composed = new Set([
  "車検で外出にする", // `${MAINTENANCE_KIND_SHORT_LABELS[kind]}にする`
  "この社員の利用を停止",
  "この車両の利用を停止",
  "このカードの登録を解除",
  "車検を開始（予定 …）",
  "やりたいこと別",
  "F・3/4・1/2・1/4・E", // 残量の表示を並べたもの（lib/fuel-level.ts）
]);
// 画面の道順（設定 → 車両登録）と、◯・… で中身を伏せた名前は比べない。
const skip = (label: string) => /→|◯|…|×/.test(label) || composed.has(label);

const help = readFileSync(helpFiles[0], "utf8");
const labels = [...new Set([...help.matchAll(/「([^「」]+)」/g)].map((match) => match[1]))];
const checked = labels.filter((label) => !skip(label));
const missing = checked.filter((label) => !source.includes(label));
assert.deepEqual(missing, [], `使い方ページの名前が画面に見つかりません。ボタン名を変えたなら使い方を直してください：${missing.join("、")}`);
const unusedComposed = [...composed].filter((label) => !labels.includes(label));
assert.deepEqual(unusedComposed, [], `使い方ページにない名前が例外の一覧に残っています：${unusedComposed.join("、")}`);
console.log(`Help labels passed: ${checked.length} names found in the screens`);
