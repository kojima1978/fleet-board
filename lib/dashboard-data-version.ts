type DashboardDataState = { version: number };

const stateKey = Symbol.for("fleetflow.dashboard-data-state");
const globalState = globalThis as typeof globalThis & { [stateKey]?: DashboardDataState };

function state() {
  return globalState[stateKey] ??= { version: 0 };
}

export function dashboardDataVersion() {
  return state().version;
}

export function markDashboardDataChanged() {
  state().version += 1;
}
