import { normalizeRow } from "../domain/conference.js";

export function parseFileMeta(fileName) {
  const clean = fileName.replace(/\.pdf$/i, "").replaceAll("_", " ").trim();
  const dateMatch = clean.match(/(\d{2})[-_.\/](\d{2})[-_.\/](\d{4})|(\d{4})[-_.\/](\d{2})[-_.\/](\d{2})/);
  let reportDate = new Date().toISOString().slice(0, 10);
  let stockName = clean;
  if (dateMatch) {
    if (dateMatch[1]) reportDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
    if (dateMatch[4]) reportDate = `${dateMatch[4]}-${dateMatch[5]}-${dateMatch[6]}`;
    stockName = clean.replace(dateMatch[0], "").replace(/^[-\s]+|[-\s]+$/g, "");
  }
  return { reportDate, stockName: stockName || "Estoque sem nome" };
}

export function parsePdfMeta(text, fallback) {
  const titleLine = text.split("\n").find((line) => /ESTOQUE/i.test(line) && /\bEM\b/i.test(line)) || "";
  const match = titleLine.match(/-\s*(.+?)\s+EM\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  if (!match) return fallback;
  return {
    stockName: match[1].trim(),
    reportDate: `${match[4]}-${match[3]}-${match[2]}`,
  };
}

export async function readPdfText(file) {
  const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs";
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(groupPdfItemsIntoRows(content.items).join("\n"));
  }
  return pages.join("\n");
}

export function groupPdfItemsIntoRows(items) {
  const rows = [];
  for (const item of items) {
    const text = item.str.trim();
    if (!text) continue;
    const x = Math.round(item.transform[4]);
    const y = Math.round(item.transform[5]);
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 5);
    if (!row) {
      row = { y, cells: [] };
      rows.push(row);
    }
    row.cells.push({ x, text });
  }

  const orderedRows = rows
    .map((row) => ({ ...row, cells: row.cells.sort((a, b) => a.x - b.x) }))
    .sort((a, b) => b.y - a.y);
  const mappedRows = mapRowsByPdfHeaders(orderedRows);
  if (mappedRows.length) return mappedRows;
  return orderedRows.map((row) => row.cells.map((cell) => cell.text).join(" | "));
}

export function parseRows(text) {
  const parsed = text.split(/\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .map(parseImportLine)
    .filter(Boolean);

  return dedupeRows(parsed);
}

export function formatImportedRow(row) {
  const base = `${row.id} | ${row.produto} | ${row.reservados} | ${row.quantidade}`;
  return row.quantidadeExtra !== "" && row.quantidadeExtra !== undefined ? `${base} | ${row.quantidadeExtra}` : base;
}

function mapRowsByPdfHeaders(orderedRows) {
  const headerIndex = orderedRows.findIndex((row) => {
    const labels = row.cells.map((cell) => normalizeHeader(cell.text));
    return labels.includes("ID")
      && labels.includes("PRODUTO")
      && labels.includes("RESERVADOS")
      && labels.includes("QUANTIDADE");
  });
  if (headerIndex === -1) return [];

  const columns = buildPdfColumns(orderedRows[headerIndex].cells);
  const required = ["ID", "PRODUTO", "RESERVADOS", "QUANTIDADE"];
  if (!required.every((key) => columns.some((column) => column.key === key))) return [];

  const imported = [];
  let current = null;
  for (const row of orderedRows.slice(headerIndex + 1)) {
    const values = valuesByPdfColumn(row.cells, columns);
    const id = joinPdfCell(values.ID);
    if (isLikelyId(id)) {
      if (current && isCompleteMappedRow(current)) imported.push(current);
      current = {
        id,
        produto: joinPdfCell(values.PRODUTO),
        reservados: firstNumeric(values.RESERVADOS),
        quantidade: firstNumeric(values.QUANTIDADE),
        quantidadeExtra: "",
      };
      continue;
    }

    if (!current) continue;
    const productContinuation = joinPdfCell(values.PRODUTO);
    if (productContinuation) current.produto = `${current.produto} ${productContinuation}`.replace(/\s+/g, " ").trim();

    const reservedContinuation = firstNumeric(values.RESERVADOS);
    const quantityContinuation = firstNumeric(values.QUANTIDADE);
    if (reservedContinuation) current.reservados = reservedContinuation;
    if (quantityContinuation) {
      if (current.quantidade) current.quantidadeExtra = quantityContinuation;
      else current.quantidade = quantityContinuation;
    }
  }
  if (current && isCompleteMappedRow(current)) imported.push(current);

  return imported
    .filter((row) => !isTotalImportRow(row))
    .map((row) => [
      row.id,
      row.produto,
      row.reservados,
      row.quantidade,
      row.quantidadeExtra || "",
    ].join(" | "));
}

function buildPdfColumns(headerCells) {
  const headerKeys = headerCells.map((cell) => normalizeHeader(cell.text));
  const hasStandardStockLayout = ["ID", "PRODUTO", "CATEGORIA", "ALIQUOTA", "RESERVADOS", "QUANTIDADE"]
    .every((key) => headerKeys.includes(key));

  if (hasStandardStockLayout) {
    return [
      { key: "ID", left: -Infinity, right: 80 },
      { key: "PRODUTO", left: 80, right: 490 },
      { key: "CATEGORIA", left: 490, right: 760 },
      { key: "ALIQUOTA", left: 760, right: 810 },
      { key: "RESERVADOS", left: 810, right: 865 },
      { key: "QUANTIDADE", left: 865, right: 930 },
      { key: "CUSTO", left: 930, right: 975 },
      { key: "CUSTO TOTAL", left: 975, right: 1030 },
      { key: "VALOR VENDA", left: 1030, right: 1095 },
      { key: "TOTAL BRUTO", left: 1095, right: Infinity },
    ];
  }

  return headerCells
    .map((cell) => ({ key: normalizeHeader(cell.text), x: cell.x }))
    .filter((column) => column.key)
    .sort((a, b) => a.x - b.x)
    .map((column, index, columns) => ({
      ...column,
      left: index === 0 ? -Infinity : (columns[index - 1].x + column.x) / 2,
      right: index === columns.length - 1 ? Infinity : (column.x + columns[index + 1].x) / 2,
    }));
}

function valuesByPdfColumn(cells, columns) {
  const values = columns.reduce((acc, column) => {
    acc[column.key] = [];
    return acc;
  }, {});

  for (const cell of cells) {
    const column = columns.find((candidate) => cell.x >= candidate.left && cell.x < candidate.right);
    if (column) values[column.key].push(cell.text);
  }
  return values;
}

function joinPdfCell(parts = []) {
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function firstNumeric(parts = []) {
  for (const part of parts) {
    const clean = String(part).replace(/^\[|\]$/g, "").trim();
    if (isStockQuantityText(clean)) return clean;
  }
  return "";
}

function isCompleteMappedRow(row) {
  return isLikelyId(row.id)
    && row.produto
    && isStockQuantityText(row.reservados)
    && isStockQuantityText(row.quantidade);
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function parseImportLine(line) {
  if (!line || shouldIgnoreImportLine(line)) return null;
  const parts = line.includes("|") ? line.split("|").map((part) => part.trim()).filter(Boolean) : null;
  const mapped = parts ? mapPipeColumns(parts) : mapTextColumns(line);
  if (!mapped || isTotalImportRow(mapped)) return null;
  const { id, produto, reservados, quantidade, quantidadeExtra } = mapped;
  if (!id || !produto || !isStockQuantityText(reservados) || !isStockQuantityText(quantidade)) return null;
  return normalizeRow({
    id,
    produto,
    reservados,
    quantidade,
    quantidadeExtra: isStockQuantityText(quantidadeExtra) ? quantidadeExtra : "",
  });
}

function mapPipeColumns(parts) {
  const isHeader = /^id$/i.test(parts[0]) || /^produto$/i.test(parts[1] || "");
  if (isHeader) return null;

  if (parts.length >= 10 && isLikelyId(parts[0])) {
    return {
      id: parts[0],
      produto: parts[1],
      reservados: parts[4],
      quantidade: parts[5],
    };
  }

  if (parts.length >= 6 && isLikelyId(parts[0]) && looksLikeCategory(parts[2])) {
    return {
      id: parts[0],
      produto: parts[1],
      reservados: parts[4],
      quantidade: parts[5],
    };
  }

  if (parts.length === 5 && isLikelyId(parts[0])) {
    return {
      id: parts[0],
      produto: parts[1],
      reservados: parts[2],
      quantidade: parts[3],
      quantidadeExtra: parts[4],
    };
  }

  if (parts.length > 4 && isLikelyId(parts[0])) return null;

  if (parts.length === 4 && isLikelyId(parts[0])) {
    return {
      id: parts[0],
      produto: parts[1],
      reservados: parts[2],
      quantidade: parts[3],
    };
  }

  return null;
}

function mapTextColumns(line) {
  const itemMatch = line.match(/^(\d{2,})\s+(.+)$/);
  if (!itemMatch) return null;
  const id = itemMatch[1];
  const rest = itemMatch[2];
  const category = findKnownCategory(rest);
  if (category) {
    const produto = rest.slice(0, category.start).trim();
    const numericSource = rest.slice(category.end);
    const numericMatches = extractNumbers(numericSource);
    const stockNumbers = numericMatches.filter((value) => isStockQuantityText(value));
    if (stockNumbers.length >= 3) {
      return {
        id,
        produto,
        reservados: stockNumbers[1],
        quantidade: stockNumbers[2],
      };
    }
  }

  const match = line.match(/^(\d+)\s+(.+?)\s+(-?\d+(?:[,.]\d+)?)\s+(-?\d+(?:[,.]\d+)?)$/);
  if (!match) return null;
  return {
    id: match[1],
    produto: match[2],
    reservados: match[3],
    quantidade: match[4],
  };
}

function isLikelyId(value) {
  return /^\d{1,12}$/.test(String(value).trim());
}

function isNumericText(value) {
  return /^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:[,.]\d+)?$/.test(String(value).trim());
}

function isStockQuantityText(value) {
  const text = String(value || "").trim();
  if (!isNumericText(text)) return false;
  const decimal = text.match(/[,.](\d+)$/)?.[1] || "";
  return decimal.length <= 3;
}

function shouldIgnoreImportLine(line) {
  return /^(JUPITER|JÚPITER|SANTAREM|PAGINA|PÁGINA|--)/i.test(line)
    || /\b(ID\s*\|?\s*PRODUTO|CATEGORIA|ALIQUOTA|ALÍQUOTA|CUSTO|VALOR VENDA|TOTAL BRUTO)\b/i.test(line)
    || /\b(QUANTIDADE TOTAL|TOTAL DE ITENS|TOTAL GERAL|TOTAIS)\b/i.test(line)
    || /\bEM\s+\d{2}\/\d{2}\/\d{4}\b/i.test(line);
}

function isTotalImportRow(row) {
  return /^0+$/.test(String(row.id).trim())
    || isNumericText(row.produto)
    || /^(total|total geral|totais?)$/i.test(String(row.produto).trim());
}

function looksLikeCategory(value) {
  return /MATERIAL|FERRAMENTAS|BATERIAS|ROTEADORES|IMPRESSORAS|PECAS|PEÇAS|COMPUTADOR|EQUIPAMENTOS/i.test(value || "");
}

function extractNumbers(value) {
  return [...String(value).matchAll(/-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+|\.\d+)?/g)].map((match) => match[0]);
}

const STOCK_CATEGORIES = [
  "MATERIAL PARA INSTALACAO CLIENTE VIA FIBRA",
  "MATERIAL PARA INSTALAÇÃO CLIENTE VIA FIBRA",
  "MATERIAL PARA INSTALACAO CLIENTE VIA RADIO",
  "MATERIAL PARA INSTALAÇÃO CLIENTE VIA RADIO",
  "MATERIAL PARA SEGURANCA DO TRABALHO",
  "MATERIAL PARA SEGURANÇA DO TRABALHO",
  "COMPUTADOR/SERVIDOR E COMPONENTES",
  "EQUIPAMENTOS PARA COMUNICACAO",
  "EQUIPAMENTOS PARA COMUNICAÇÃO",
  "MATERIAL PARA IPTV",
  "MATERIAL PARA ESTRUTURA VIA FIBRA",
  "MATERIAL PARA ESTRUTURA VIA RADIO",
  "MATERIAL PARA ESCRITORIO",
  "MATERIAL PARA ESCRITÓRIO",
  "MATERIAS DE CONSTRUCAO",
  "MATERIAIS DE CONSTRUCAO",
  "MATERIAIS ELÉTRICOS",
  "MATERIAIS ELETRICOS",
  "PECAS PARA AUTOMOVEIS",
  "PEÇAS PARA AUTOMÓVEIS",
  "IMPRESSORAS",
  "FERRAMENTAS",
  "ROTEADORES",
  "BATERIAS",
];

function findKnownCategory(value) {
  const normalized = normalizeHeader(value);
  for (const category of STOCK_CATEGORIES) {
    const start = normalized.indexOf(normalizeHeader(category));
    if (start >= 0) {
      return { start, end: start + category.length };
    }
  }
  return null;
}

function dedupeRows(rows) {
  const byId = new Map();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()];
}
