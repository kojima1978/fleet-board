export const csvCell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;

// BOM and CRLF so Excel opens the Japanese text without garbling.
export const csvText = (rows: (string | number)[][]) => `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;

export function csvResponse(body: string, filename: string) {
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
}
