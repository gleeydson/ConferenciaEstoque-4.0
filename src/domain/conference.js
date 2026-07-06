export function normalizeRow(row) {
  return {
    id: String(row.id || "").trim(),
    produto: String(row.produto || "").trim(),
    reservados: numberOrZero(row.reservados),
    quantidade: numberOrZero(row.quantidade),
    quantidadeExtra: row.quantidadeExtra === undefined || row.quantidadeExtra === null || row.quantidadeExtra === ""
      ? ""
      : numberOrZero(row.quantidadeExtra),
    fisica: row.fisica === undefined || row.fisica === null ? "" : row.fisica,
    observacao: row.observacao || "",
    changedBy: numberOrZero(row.changedBy),
    movement: row.movement || "same",
  };
}

export function numberOrZero(value) {
  const text = String(value ?? "0").trim();
  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : text;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getDiff(row) {
  if (row.fisica === "" || row.fisica === null || row.fisica === undefined) return null;
  const diff = Number(row.fisica) - Number(row.quantidade);
  return Number.isFinite(diff) ? diff : null;
}

export function getRowStatus(row) {
  const diff = getDiff(row);
  if (diff === null) return { label: "Pendente", color: "gray" };
  if (diff === 0) return { label: "Alinhado", color: "green" };
  if (diff > 0) return { label: "Sobrando", color: "amber" };
  return { label: "Faltando", color: "red" };
}

export function getProgress(conference) {
  const counted = conference.rows.filter((row) => getDiff(row) !== null).length;
  const divergent = conference.rows.filter((row) => {
    const diff = getDiff(row);
    return diff !== null && diff !== 0;
  }).length;
  const changed = conference.rows.filter((row) => row.movement !== "same").length;
  return {
    total: conference.rows.length,
    counted,
    pending: conference.rows.length - counted,
    divergent,
    changed,
  };
}
