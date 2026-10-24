"use client";

// 利用者の保存先。各自のPCは「この端末の利用者」としてブラウザーを閉じても残し、
// 入口の共用端末は社員証で確認した人をタブを閉じるまで（操作が終わるまで）だけ持つ。
const ID_KEY = "fleetflow.employeeId";
const NAME_KEY = "fleetflow.employeeName";

export type SavedEmployee = { id: string; name: string | null; persistent: boolean };

function storages() {
  return { session: window.sessionStorage, local: window.localStorage };
}

export function readSavedEmployee(): SavedEmployee | null {
  try {
    const { session, local } = storages();
    const sessionId = session.getItem(ID_KEY);
    if (sessionId) return { id: sessionId, name: session.getItem(NAME_KEY), persistent: false };
    const localId = local.getItem(ID_KEY);
    return localId ? { id: localId, name: local.getItem(NAME_KEY), persistent: true } : null;
  } catch {
    return null;
  }
}

export function saveEmployee(person: { id: string; name: string }, persistent: boolean) {
  try {
    const { session, local } = storages();
    const target = persistent ? local : session;
    clearSavedEmployee();
    target.setItem(ID_KEY, person.id);
    target.setItem(NAME_KEY, person.name);
  } catch {
    // 保存できなくても、この画面を開いている間は選んだ利用者で操作できる。
  }
}

export function clearSavedEmployee() {
  try {
    const { session, local } = storages();
    for (const storage of [session, local]) {
      storage.removeItem(ID_KEY);
      storage.removeItem(NAME_KEY);
    }
  } catch {
    // 保存先を使えない環境では消すものもない。
  }
}

// 共用端末では「この端末の利用者」を残さない。NFC Bridgeを検出する前に各自のPCとして保存したものも消す。
export function forgetPersistentEmployee() {
  try {
    const { local } = storages();
    const had = local.getItem(ID_KEY) !== null;
    local.removeItem(ID_KEY);
    local.removeItem(NAME_KEY);
    return had;
  } catch {
    return false;
  }
}
