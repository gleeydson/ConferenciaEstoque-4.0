import assert from "node:assert/strict";
import test from "node:test";
import { formatImportedRow, groupPdfItemsIntoRows, groupPdfPagesIntoRows, parseFileMeta, parsePdfMeta, parseRows } from "../src/import/pdfParser.js";

function item(text, x, y) {
  return { str: text, transform: [1, 0, 0, 1, x, y] };
}

test("maps fixed PDF columns and keeps roll count from continuation row", () => {
  const lines = groupPdfItemsIntoRows([
    item("1.11 - ESTOQUE DE LOCACAO JUPITER TELECOM - DOM ELISEU EM 05/07/2026 17:17:16", 345, 742),
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
  const meta = parsePdfMeta(lines.join("\n"), parseFileMeta("1.11 - ESTOQUE DE LOCACAO JUPITER TELECOM.pdf"));

  assert.equal(meta.reportTime, "17:17:16");
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

test("reuses PDF column layout on pages without repeated header", () => {
  const lines = groupPdfPagesIntoRows([
    [
      item("2.12 - ESTOQUE MATERIAL EM 06/07/2026 16:32:07", 345, 742),
      item("ID", 53, 714),
      item("PRODUTO", 273, 714),
      item("CATEGORIA", 603, 714),
      item("ALÍQUOTA", 761, 714),
      item("RESERVADOS", 812, 714),
      item("QUANTIDADE", 870, 714),
      item("CUSTO", 937, 714),
      item("1001", 46, 689),
      item("ADAPTADOR SC/PC", 88, 689),
      item("MATERIAL PARA INSTALACAO CLIENTE VIA FIBRA", 499, 689),
      item("0,00", 846, 689),
      item("41,00", 887, 689),
      item("0,474596", 942, 689),
    ],
    [
      item("PÁGINA 2", 1030, 742),
      item("17368", 46, 689),
      item("BUCHA DE NYLON-06MM", 88, 689),
      item("MATERIAL PARA INSTALACAO CLIENTE VIA FIBRA", 499, 689),
      item("20,00", 846, 689),
      item("1.466,00", 887, 689),
      item("0,030240", 942, 689),
      item("44,33", 985, 689),
    ],
  ]);
  const rows = parseRows(lines.join("\n"));

  assert.equal(rows.length, 2);
  assert.equal(rows[1].id, "17368");
  assert.equal(rows[1].reservados, 20);
  assert.equal(rows[1].quantidade, 1466);
  assert.equal(rows[1].quantidadeExtra, "");
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
  assert.equal(meta.stockName, "1.11 - ESTOQUE DE LOCACAO JUPITER TELECOM - DOM ELISEU");
  assert.equal(meta.reportDate, "2026-07-01");
  assert.equal(meta.reportTime, "10:09:12");
  assert.equal(meta.reportDateTime, "2026-07-01T10:09:12");

  const withTime = parseFileMeta("05-07-2026 17h17 - 1.11 - ESTOQUE DE LOCACAO.pdf");
  assert.equal(withTime.reportTime, "17:17:00");

  const warehouse = parsePdfMeta("4.010 - TI 1 - ALMOXARIFADO TI 1 DOM ELISEU EM 06/07/2026 23:14:08", fallback);
  assert.equal(warehouse.stockName, "4.010 - TI 1 - ALMOXARIFADO TI 1 DOM ELISEU");
  assert.equal(warehouse.reportTime, "23:14:08");
});
