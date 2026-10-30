import assert from "node:assert/strict";
import { FuelReturnNoticeMessage } from "../components/fuel-return-notice-message";
import { defaultFuelReturnNotice } from "../lib/fuel-return-notice";
import { renderToStaticMarkup } from "react-dom/server";
import { FuelLevelLabel, FuelReminder } from "../components/fleet-dashboard";
import { FUEL_LEVEL_LABELS, needsReturnFuelReminder, needsStartFuelReminder } from "../lib/fuel-level";

FUEL_LEVEL_LABELS.forEach((label, level) => {
  const compact = renderToStaticMarkup(<FuelLevelLabel level={level} compact />);
  const detail = renderToStaticMarkup(<FuelLevelLabel level={level} />);
  assert.equal(compact, `<span class="whitespace-nowrap">ガソリン残量 ${label}</span>`);
  assert.equal(detail, `<span class="whitespace-nowrap">ガソリン残量 ${label}</span>`);
  assert.doesNotMatch(compact, /<br/);
});

for (const level of [0, 1, 2]) assert.equal(needsStartFuelReminder(level), true, `${FUEL_LEVEL_LABELS[level]}は利用開始時の給油案内の対象`);
for (const level of [3, 4]) assert.equal(needsStartFuelReminder(level), false, `${FUEL_LEVEL_LABELS[level]}は利用開始時の給油案内の対象外`);
for (const level of [0, 1]) assert.equal(needsReturnFuelReminder(level), true, `${FUEL_LEVEL_LABELS[level]}は返却時の給油案内の対象`);
for (const level of [2, 3, 4]) assert.equal(needsReturnFuelReminder(level), false, `${FUEL_LEVEL_LABELS[level]}は返却時の給油案内の対象外`);
assert.equal(needsStartFuelReminder(null), false, "残量未登録では利用開始時の給油案内を断定しない");
assert.equal(needsReturnFuelReminder(null), false, "残量未登録では返却時の給油案内を断定しない");

const startReminder = renderToStaticMarkup(<FuelReminder context="start" />);
assert.match(startReminder, /ガソリン残量が1\/2以下です/);
assert.match(startReminder, /可能であれば、利用中の給油をお願いします。/);
assert.doesNotMatch(startReminder, /次回から/);
assert.doesNotMatch(startReminder, /fuel-reminder-attention/, "確認画面では給油案内を静止表示にする");
const attentionReminder = renderToStaticMarkup(<FuelReminder context="start" attention />);
assert.match(attentionReminder, /fuel-reminder-attention/, "詳細入力画面を開いた直後だけ給油案内を短く強調する");
const returnReminder = renderToStaticMarkup(<FuelReminder context="return" attention />);
assert.match(returnReminder, /ガソリン残量が1\/2未満です/);
assert.doesNotMatch(returnReminder, /1\/2以下/);
assert.match(returnReminder, /次回から、可能な範囲で給油してから返却をお願いします。/);
assert.doesNotMatch(returnReminder, /利用中の給油/);
assert.match(returnReminder, /fuel-reminder-attention/, "返却時も給油案内を短く強調する");
console.log("Fuel label tests passed: compact/detail labels, all five levels and no-wrap fractions");
const notice = { ...defaultFuelReturnNotice(1), audioUrl: "/api/settings/fuel-return/1/audio?v=1" };
assert.deepEqual([4, 3, 2, 1, 0].map((level) => defaultFuelReturnNotice(level as 0 | 1 | 2 | 3 | 4).enabled), [false, false, false, true, true], "初期設定は1/4以下だけ案内する");
assert.deepEqual([4, 3, 2, 1, 0].map((level) => defaultFuelReturnNotice(level as 0 | 1 | 2 | 3 | 4).displayMode), ["NONE", "NONE", "NONE", "MODAL", "MODAL"], "初期設定は1/4以下だけポップ表示する");
assert.match(renderToStaticMarkup(<FuelReturnNoticeMessage notice={notice} kiosk={false} />), /fuel-reminder-attention/, "強調ONではアニメーション用クラスを付ける");
assert.doesNotMatch(renderToStaticMarkup(<FuelReturnNoticeMessage notice={{ ...notice, displayMode: "MESSAGE", animated: false }} kiosk={false} />), /fuel-reminder-attention/, "メッセージ表示では静止表示にする");
assert.match(renderToStaticMarkup(<FuelReturnNoticeMessage notice={{ ...notice, displayMode: "EMPHASIZED" }} kiosk={false} />), /fuel-reminder-attention/, "強調表示ではアニメーション用クラスを付ける");
assert.doesNotMatch(renderToStaticMarkup(<FuelReturnNoticeMessage notice={notice} kiosk={false} />), /<audio/, "各自PCは音声を読み込まない");
assert.match(renderToStaticMarkup(<FuelReturnNoticeMessage notice={notice} kiosk />), /<audio.*controls/, "共用端末は自動再生できない場合も手動再生できる");
assert.doesNotMatch(renderToStaticMarkup(<FuelReturnNoticeMessage notice={{ ...notice, audioEnabled: false }} kiosk />), /<audio/, "音声なしでは登録済み音声を読み込まない");
