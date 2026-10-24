// 社員番号・車両番号は英字1文字＋数字3桁に固定しているため、テストでは指定した英字で未使用の番号を後ろから選ぶ。
export async function freeRecordCodes(client, table, letter, count) {
  const { rows } = await client.query(`SELECT code FROM "${table}" WHERE code LIKE $1`, [`${letter}%`]);
  const used = new Set(rows.map((row) => row.code));
  const codes = [];
  for (let number = 999; number >= 0 && codes.length < count; number -= 1) {
    const code = `${letter}${String(number).padStart(3, "0")}`;
    if (!used.has(code)) codes.push(code);
  }
  if (codes.length < count) throw new Error(`${table}に未使用の${letter}番号が${count}件ありません`);
  return codes;
}
