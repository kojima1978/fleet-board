import assert from "node:assert/strict";
import { scannerSetupFilename } from "../lib/scanner-setup";

for (const origin of ["http://192.168.0.134:3035", "http://192.168.0.246:3035", "http://localhost:3035", "https://fleetflow.example"]) {
  const filename = scannerSetupFilename(origin);
  assert.match(filename, /^FleetFlow-Setup-[A-Za-z0-9_-]+\.exe$/);
  const encoded = filename.slice("FleetFlow-Setup-".length, -4);
  assert.equal(Buffer.from(encoded, "base64url").toString(), origin, "installer must receive the exact server origin without manual input");
  assert.ok(filename.length < 255);
}
assert.throws(() => scannerSetupFilename("file:///tmp/setup"));
assert.throws(() => scannerSetupFilename("http://user:password@example.com"));
console.log("Scanner setup tests passed: exact LAN/localhost/HTTPS Origins, safe filenames and invalid URL rejection");
