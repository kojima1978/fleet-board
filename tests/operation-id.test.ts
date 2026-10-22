import assert from "node:assert/strict";
import { z } from "zod";
import { createOperationId } from "../lib/operation-id";

const uuid = z.string().uuid();
const nativeId = globalThis.crypto.randomUUID();
assert.equal(createOperationId({ randomUUID: () => nativeId, getRandomValues: () => { throw new Error("Fallback must not run"); } }), nativeId);

// HTTP LANブラウザーと同様にrandomUUIDだけが存在しない環境。
const httpCrypto = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) };
const ids = Array.from({ length: 10_000 }, () => createOperationId(httpCrypto));
for (const id of ids) {
  assert.equal(uuid.safeParse(id).success, true, "APIが検証するUUID形式を満たす");
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
}
assert.equal(new Set(ids).size, ids.length, "別の操作には異なるIDを生成する");

const deterministicCrypto = { getRandomValues: ((array: Uint8Array) => { array.fill(255); return array; }) as Crypto["getRandomValues"] };
assert.equal(createOperationId(deterministicCrypto), "ffffffff-ffff-4fff-bfff-ffffffffffff", "UUID v4のバージョンとvariantを設定する");
assert.throws(() => createOperationId({} as Crypto), /Secure random number generation is unavailable/);
assert.equal(uuid.safeParse(createOperationId()).success, true);
console.log("Operation ID tests passed: native UUID, HTTP fallback, API validation, version bits and uniqueness");
