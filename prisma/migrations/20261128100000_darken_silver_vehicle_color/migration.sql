-- シルバーの見本色をホワイトと見分けやすい濃さに変えたので、登録済みのシルバーの車も新しい色にそろえる。
UPDATE "Vehicle"
SET "color" = '#A3ACB9', "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE upper("color") = '#C0C6CF';
