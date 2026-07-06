import assert from "node:assert/strict";
import test from "node:test";
import { formatImportedRow, groupPdfItemsIntoRows, parseFileMeta, parsePdfMeta, parseRows } from "../src/import/pdfParser.js";

function item(text, x, y) {
  return { str: text, transform: [1, 0, 0, 1, x, y] };
}

test("maps fixed PDF columns and keeps roll count from continuation row", () => {
  const lines = groupPdfItemsIntoRows([
    item("ID", 53, 714),
    item("PRODUTO", 273, 714),
    item("CATEGORIA", 603, 714),
    item("ALÍQUOTA", 761, 714),
    item("RESERVADOS", 812, 714),
    item("QUANTIDADE", 870, 714),
    item("CUSTO", 937, 714),
    item("22947", 46, 689),
    item("CABO CFOAC OPTICO SPEED STAR MINI FLAT DROP GLUED OPTY RAY 1F- BLUECOM [BOBINA CFOAC-", 88, 689),
    item("MATERIAL PARA INSTALACAO CLIENTE VIA RADIO", 499, 689),
    item("0,00", 846, 689),
    item("7.000,00", 887, 689),
    item("0,474596", 942, 689),
    item("01FO- 1KM - BLUECOM]", 88, 678),
    item("[7,00]", 898, 678),
  ]);

  const rows = parseRows(lines.join("\n"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "22947");
  assert.equal(rows[0].reservados, 0);
  assert.equal(rows[0].quantidade, 7000);
  assert.equal(rows[0].quantidadeExtra, 7);
  assert.match(rows[0].produto, /01FO- 1KM - BLUECOM\]/);
});

test("maps normal stock rows without mixing cost into quantity", () => {
  const rows = parseRows("17368 | BUCHA DE NYLON-06MM | MATERIAL PARA INSTALACAO CLIENTE VIA FIBRA | 1,000000 | 20,00 | 1.466,00 | 0,030240 | 44,33 | 0,03 | 43,98");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "17368");
  assert.equal(rows[0].reservados, 20);
  assert.equal(rows[0].quantidade, 1466);
  assert.equal(rows[0].quantidadeExtra, "");
});

test("ignores total footer rows", () => {
  const rows = parseRows("000000 | 0,00 | 99,8 | 99,8");
  assert.equal(rows.length, 0);
});

test("formats optional roll count", () => {
  assert.equal(formatImportedRow({
    id: "16421",
    produto: "CABO DROP",
    reservados: 1575,
    quantidade: 15199,
    quantidadeExtra: 16,
  }), "16421 | CABO DROP | 1575 | 15199 | 16");
});

test("extracts metadata from filename and PDF title", () => {
  const fallback = parseFileMeta("05-07-2026 - 1.11 - ESTOQUE DE LOCACAO JUPITER TELECOM.pdf");
  assert.equal(fallback.reportDate, "2026-07-05");

  const meta = parsePdfMeta("1.11 - ESTOQUE DE LOCACAO JUPITER TELECOM - DOM ELISEU EM 01/07/2026 10:09:12", fallback);
  assert.equal(meta.stockName, "ESTOQUE DE LOCACAO JUPITER TELECOM - DOM ELISEU");
  assert.equal(meta.reportDate, "2026-07-01");
});
