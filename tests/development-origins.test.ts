import assert from "node:assert/strict";
import { getDevelopmentOrigins } from "../lib/development-origins";

assert.deepEqual(getDevelopmentOrigins({}), []);
assert.deepEqual(getDevelopmentOrigins({ FLEETFLOW_DEV_BIND_ADDRESS: "127.0.0.1", FLEETFLOW_DEV_HOST_NAME: " SERVER-PC ", FLEETFLOW_DEV_ALLOWED_ORIGINS: "192.168.0.246,10.0.0.20,192.168.0.246" }), ["127.0.0.1", "server-pc", "192.168.0.246", "10.0.0.20"]);
assert.deepEqual(getDevelopmentOrigins({ FLEETFLOW_DEV_BIND_ADDRESS: "0.0.0.0", FLEETFLOW_DEV_ALLOWED_ORIGINS: "192.168.0.246,*,192.168.*.*,http://evil.example,example.com:3035," }), ["192.168.0.246"]);
assert.deepEqual(getDevelopmentOrigins({ FLEETFLOW_DEV_ALLOWED_ORIGINS: "192.168.0.134" }), ["192.168.0.134"]);
assert.deepEqual(getDevelopmentOrigins({ FLEETFLOW_DEV_ALLOWED_ORIGINS: "192.168.0.246" }), ["192.168.0.246"], "起動ごとに検出したIPへ置き換わる");
console.log("Development Origin tests passed: detected LAN IPs, hostnames, IP changes and wildcard rejection");
