import assert from "node:assert/strict";
import { isSameOriginRequest } from "../lib/request-security";

const previousTrustProxy = process.env.FLEETFLOW_TRUST_PROXY;
try {
  process.env.FLEETFLOW_TRUST_PROXY = "false";
  assert.equal(isSameOriginRequest(new Request("http://app:3000/api/dashboard")), true, "Originがないサーバー間通信は許可する");
  assert.equal(isSameOriginRequest(new Request("http://app:3000/api/dashboard", { headers: { Host: "localhost:3035", Origin: "http://localhost:3035" } })), true, "Docker内部URLと公開Hostが異なる正規リクエストを許可する");
  assert.equal(isSameOriginRequest(new Request("http://app:3000/api/dashboard", { headers: { Host: "localhost:3035", Origin: "http://evil.example" } })), false, "外部Originを拒否する");
  assert.equal(isSameOriginRequest(new Request("http://app:3000/api/dashboard", { headers: { Host: "app:3000", Origin: "https://fleetflow.example", "X-Forwarded-Proto": "https", "X-Forwarded-Host": "fleetflow.example" } })), false, "未信頼プロキシの転送ヘッダーを使用しない");

  process.env.FLEETFLOW_TRUST_PROXY = "true";
  assert.equal(isSameOriginRequest(new Request("http://app:3000/api/dashboard", { headers: { Host: "app:3000", Origin: "https://fleetflow.example", "X-Forwarded-Proto": "https", "X-Forwarded-Host": "fleetflow.example" } })), true, "信頼済みHTTPSプロキシ経由の正規Originを許可する");
  assert.equal(isSameOriginRequest(new Request("http://app:3000/api/dashboard", { headers: { Host: "app:3000", Origin: "https://evil.example", "X-Forwarded-Proto": "https", "X-Forwarded-Host": "fleetflow.example" } })), false, "信頼済みプロキシ経由でも外部Originを拒否する");
  console.log("Request security tests passed: direct Docker, external Origin and trusted HTTPS proxy");
} finally {
  if (previousTrustProxy === undefined) delete process.env.FLEETFLOW_TRUST_PROXY;
  else process.env.FLEETFLOW_TRUST_PROXY = previousTrustProxy;
}
