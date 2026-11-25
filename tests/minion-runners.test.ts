import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { perimeterRunnerPose, subscribeToMinionIdle } from "../components/minion-perimeter-runners";
import { ACTIVITY_EVENT } from "../components/idle-traffic";

const closeTo = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.0001, `${actual} should equal ${expected}`);
const topLeft = perimeterRunnerPose(0);
closeTo(topLeft.x, -7.55);
closeTo(topLeft.y, 3.95);
const topRight = perimeterRunnerPose(15.1 / 46);
closeTo(topRight.x, 7.55);
closeTo(topRight.y, 3.95);
const bottomRight = perimeterRunnerPose(0.5);
closeTo(bottomRight.x, 7.55);
closeTo(bottomRight.y, -3.95);
closeTo(perimeterRunnerPose((15.1 + 3.95) / 46).rotationY, 0);
const bottomLeft = perimeterRunnerPose((15.1 * 2 + 7.9) / 46);
closeTo(bottomLeft.x, -7.55);
closeTo(bottomLeft.y, -3.95);
closeTo(perimeterRunnerPose((15.1 * 2 + 7.9 + 3.95) / 46).rotationY, Math.PI);

const gitignore = readFileSync(".gitignore", "utf8");
assert.match(gitignore, /local-assets\/minions\/\*/);
const compose = readFileSync("compose.yaml", "utf8");
const productionCompose = readFileSync("compose.production.yaml", "utf8");
assert.match(compose, /\.\/local-assets\/minions:\/app\/public\/local-assets\/minions:ro/);
assert.match(productionCompose, /\.\/local-assets\/minions:\/app\/public\/local-assets\/minions:ro/);
const component = readFileSync("components/minion-perimeter-runners.tsx", "utf8");
const dashboard = readFileSync("components/fleet-dashboard.tsx", "utf8");
const deviceSettings = readFileSync("lib/device-mode.ts", "utf8");
const systemSettings = readFileSync("components/system-status-panel.tsx", "utf8");
const probeRoute = readFileSync("app/api/local-assets/minion/route.ts", "utf8");
assert.match(component, /\/api\/local-assets\/minion/);
assert.match(deviceSettings, /fleetflow\.minionAnimation/);
assert.match(deviceSettings, /\(value\) => value === "on"/);
assert.match(dashboard, /minionAnimationEnabled \? <MinionPerimeterRunners/);
assert.match(systemSettings, /駐車場3Dアニメーション/);
assert.match(probeRoute, /status: 204/);
assert.match(probeRoute, /X-FleetFlow-Model-Available/);

const browser = new EventTarget();
const page = Object.assign(new EventTarget(), { hidden: false });
let pending: (() => void) | undefined;
Object.assign(globalThis, {
  window: Object.assign(browser, {
    setTimeout(callback: () => void, delay: number) {
      assert.equal(delay, 30_000);
      pending = callback;
      return 1;
    },
    clearTimeout() { pending = undefined; },
  }),
  document: page,
});

let idle = true;
const unsubscribe = subscribeToMinionIdle((value) => { idle = value; });
assert.equal(idle, false);
for (const event of ["pointerdown", "click", "keydown", "wheel", ACTIVITY_EVENT]) {
  assert.ok(pending);
  pending();
  assert.equal(idle, true);
  const previousTimer = pending;
  browser.dispatchEvent(new Event(event));
  assert.equal(idle, false);
  assert.notEqual(pending, previousTimer);
}
page.hidden = true;
page.dispatchEvent(new Event("visibilitychange"));
assert.equal(idle, false);
assert.equal(pending, undefined);
page.hidden = false;
page.dispatchEvent(new Event("visibilitychange"));
assert.ok(pending);
unsubscribe();
assert.equal(pending, undefined);

console.log("Minion perimeter runner tests passed: four-edge route, quiet optional-asset probe, local-only ignore and read-only mounts");
