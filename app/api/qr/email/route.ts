import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { z } from "zod";
import { createMailTransport, getMailConfig } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { qrPayload } from "@/lib/qr-code";
import { consumeRateLimit, isSameOriginRequest, readJsonBody, requestClientKey } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({ employeeIds: z.array(z.string().min(1)).min(1).max(100) }).refine(
  ({ employeeIds }) => new Set(employeeIds).size === employeeIds.length,
  "同じ社員が複数回選択されています",
);

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);

export async function GET() {
  return NextResponse.json({ configured: !!getMailConfig() });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: "送信元を確認できません" }, { status: 403 });
  const rate = consumeRateLimit("employee-qr-email", requestClientKey(request), 10, 60_000);
  if (!rate.allowed) return NextResponse.json({ message: "短時間に送信操作が集中しています。しばらく待ってから再試行してください" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });

  const config = getMailConfig();
  if (!config) return NextResponse.json({ message: "メール配信が設定されていません。管理者にSMTP設定を依頼してください" }, { status: 503 });

  let parsed: z.infer<typeof requestSchema>;
  try {
    parsed = requestSchema.parse(await readJsonBody(request, 10_240));
  } catch (error) {
    if (error instanceof Error && error.message === "REQUEST_TOO_LARGE") return NextResponse.json({ message: "送信対象が多すぎます" }, { status: 413 });
    return NextResponse.json({ message: error instanceof z.ZodError ? error.issues[0]?.message ?? "入力内容を確認してください" : "入力内容を確認してください" }, { status: 400 });
  }

  const employees = await prisma.employee.findMany({
    where: { id: { in: parsed.employeeIds }, active: true },
    select: { id: true, name: true, email: true, qrToken: true, employeeNumber: { select: { code: true } } },
  });
  if (employees.length !== parsed.employeeIds.length) return NextResponse.json({ message: "利用停止中または存在しない社員が含まれています。画面を更新してください" }, { status: 409 });
  const missing = employees.filter((employee) => !employee.email);
  if (missing.length) return NextResponse.json({ message: `メール未登録の社員が含まれています：${missing.map((employee) => employee.name).join("、")}` }, { status: 400 });

  const transport = createMailTransport(config);
  const results = await Promise.allSettled(employees.map(async (employee) => {
    const image = await QRCode.toBuffer(qrPayload("employee", employee.qrToken), { type: "png", errorCorrectionLevel: "M", margin: 2, width: 640, color: { dark: "#0f172a", light: "#ffffff" } });
    const safeName = escapeHtml(employee.name);
    const safeCode = escapeHtml(employee.employeeNumber.code);
    await transport.sendMail({
      from: config.from,
      to: employee.email!,
      subject: "【FleetFlow】社員QRコード",
      text: `${employee.name} 様\n\nFleetFlowの社員QRコードをお送りします。添付画像を保存してご利用ください。\n社員番号: ${employee.employeeNumber.code}\n\n紛失・誤送信時は管理者へ連絡し、QRコードを再発行してください。`,
      html: `<p>${safeName} 様</p><p>FleetFlowの社員QRコードをお送りします。画像を保存してご利用ください。</p><p><strong>社員番号：${safeCode}</strong></p><p><img src="cid:fleetflow-qr" width="320" height="320" alt="FleetFlow社員QRコード"></p><p>紛失・誤送信時は管理者へ連絡し、QRコードを再発行してください。</p>`,
      attachments: [{ filename: `fleetflow-${employee.employeeNumber.code}.png`, content: image, contentType: "image/png", cid: "fleetflow-qr" }],
    });
    return employee;
  }));
  transport.close();

  const auditRows = results.map((result, index) => ({
    operationId: randomUUID(),
    actorName: "設定画面",
    action: result.status === "fulfilled" ? "社員QRメール送信" : "社員QRメール送信失敗",
    targetType: "Employee",
    targetId: employees[index].id,
    description: `${employees[index].name}へのQRメール${result.status === "fulfilled" ? "送信完了" : "送信失敗"}`,
  }));
  await prisma.auditLog.createMany({ data: auditRows });

  results.forEach((result, index) => {
    if (result.status === "rejected") console.error("Employee QR email delivery failed", { employeeId: employees[index].id, error: result.reason instanceof Error ? result.reason.message : "unknown" });
  });
  const sent = results.filter((result) => result.status === "fulfilled").length;
  const failedEmployees = results.flatMap((result, index) => result.status === "rejected" ? [{ id: employees[index].id, name: employees[index].name }] : []);
  return NextResponse.json({ sent, failed: failedEmployees.length, failedEmployees }, { status: sent ? 200 : 502 });
}
