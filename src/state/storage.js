export const STORAGE_KEY = "conferencia-estoque-4";

export function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return { conferences: [] };

  const parsed = JSON.parse(saved);
  parsed.conferences = (parsed.conferences || []).filter(
    (conference) => conference.stockName?.trim().toLowerCase() !== "estoque central",
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  return parsed;
}

export function saveStoredData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function createBackupPayload(data) {
  return {
    app: "ConferenciaEstoque",
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export function downloadJson(payload, fileName) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
