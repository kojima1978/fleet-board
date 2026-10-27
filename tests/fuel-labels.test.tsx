import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { FuelLevelLabel } from "../components/fleet-dashboard";
import { FUEL_LEVEL_LABELS } from "../lib/fuel-level";

FUEL_LEVEL_LABELS.forEach((label, level) => {
  const compact = renderToStaticMarkup(<FuelLevelLabel level={level} compact />);
  const detail = renderToStaticMarkup(<FuelLevelLabel level={level} />);
  assert.equal(compact, `<span class="whitespace-nowrap">燃料 ${label}</span>`);
  assert.equal(detail, `<span class="whitespace-nowrap">ガソリン残量 ${label}</span>`);
  assert.doesNotMatch(compact, /<br/);
});
console.log("Fuel label tests passed: compact/detail labels, all five levels and no-wrap fractions");
