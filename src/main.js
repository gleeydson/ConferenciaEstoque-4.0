import { createBackupPayload, downloadJson, loadData, saveStoredData } from "./state/storage.js";
import { getDiff, getProgress, getRowStatus, normalizeRow, numberOrZero } from "./domain/conference.js";
import { parseFileMeta, parsePdfMeta, parseRows, readPdfText } from "./import/pdfParser.js";

const seedRows = [
  { id: "1001", produto: "Cadeira Tiffany cristal", reservados: 4, quantidade: 32 },
  { id: "1002", produto: "Mesa redonda madeira 1,60m", reservados: 2, quantidade: 14 },
  { id: "1003", produto: "Sousplat dourado", reservados: 36, quantidade: 180 },
  { id: "1004", produto: "Toalha linho off-white", reservados: 12, quantidade: 68 },
  { id: "1005", produto: "Castiçal vidro alto", reservados: 0, quantidade: 41 },
  { id: "1006", produto: "Prato raso porcelana", reservados: 96, quantidade: 340 },
  { id: "1007", produto: "Taça cristal vinho", reservados: 144, quantidade: 520 },
  { id: "1008", produto: "Guardanapo verde oliva", reservados: 80, quantidade: 215 },
];

const state = {
  page: "dashboard",
  filter: "todos",
  activeConferenceId: null,
  activeProductHistory: null,
  activeStockName: "",
  importRows: [],
  importing: false,
  toast: "",
  data: loadData(),
};

const ROUTES = {
  dashboard: "dashboard",
  import: "importar",
  history: "historico",
  stocks: "estoques",
};

const ROUTES_BY_HASH = Object.fromEntries(Object.entries(ROUTES).map(([page, route]) => [route, page]));

function saveData() {
  saveStoredData(state.data);
}

function createConference(report, previous) {
  const previousRows = new Map((previous?.rows || []).map((row) => [String(row.id), row]));
  const incomingIds = new Set(report.rows.map((row) => String(row.id)));

  const rows = report.rows.map((row) => {
    const old = previousRows.get(String(row.id));
    const changedBy = old ? Number(row.quantidade) - Number(old.quantidade) : 0;
    const preservedPhysical = old && old.fisica !== "" && changedBy === 0 ? old.fisica : "";
    const preservedObs = old && old.observacao && changedBy === 0 ? old.observacao : "";
    return normalizeRow({
      ...row,
      fisica: row.fisica ?? preservedPhysical,
      observacao: row.observacao ?? preservedObs,
      changedBy,
      movement: old ? (changedBy === 0 ? "same" : "changed") : "added",
    });
  });

  for (const old of previousRows.values()) {
    if (!incomingIds.has(String(old.id))) {
      rows.push(normalizeRow({
        ...old,
        quantidade: 0,
        fisica: old.fisica ?? "",
        changedBy: -Number(old.quantidade),
        movement: "removed",
        observacao: old.observacao || "Removido no novo relatorio",
      }));
    }
  }

  const conference = {
    id: crypto.randomUUID(),
    stockName: report.stockName || "Estoque sem nome",
    reportDate: report.reportDate || new Date().toISOString().slice(0, 10),
    fileName: report.fileName,
    createdAt: new Date().toISOString(),
    status: "Pendente",
    rows,
  };
  conference.status = getProgress(conference).pending === 0 ? "Concluida" : "Pendente";
  return conference;
}

function latestByStock(stockName) {
  return state.data.conferences
    .filter((item) => item.stockName.toLowerCase() === stockName.toLowerCase())
    .sort((a, b) => new Date(b.reportDate) - new Date(a.reportDate))[0];
}

function setPage(page) {
  navigateToPage(page);
}

function applyPage(page) {
  state.page = page;
  state.filter = "todos";
  render();
}

function setActiveConference(id) {
  navigateToConference(id);
}

function applyActiveConference(id) {
  state.activeConferenceId = id;
  state.page = "conference";
  state.filter = "todos";
  state.activeProductHistory = null;
  render();
}

function navigateToPage(page) {
  const route = ROUTES[page] || ROUTES.dashboard;
  setHash(`#${route}`);
}

function navigateToConference(id) {
  setHash(`#conferencia/${encodeURIComponent(id)}`);
}

function setHash(hash) {
  if (window.location.hash === hash) {
    applyRouteFromHash();
    return;
  }
  window.location.hash = hash;
}

function applyRouteFromHash() {
  const hash = decodeURIComponent(window.location.hash.replace(/^#\/?/, ""));
  const [route, id] = hash.split("/");

  if (route === "conferencia" && id) {
    const exists = state.data.conferences.some((item) => item.id === id);
    if (exists) {
      applyActiveConference(id);
      return;
    }
  }

  const page = ROUTES_BY_HASH[route] || "dashboard";
  applyPage(page);
}

function showToast(message) {
  state.toast = message;
  renderToast();
  setTimeout(() => {
    if (state.toast === message) {
      state.toast = "";
      renderToast();
    }
  }, 2600);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function formatIntegerDisplay(value) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (!Number.isInteger(number)) return String(value);
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(number);
}

function signed(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  const formatted = formatIntegerDisplay(number);
  return number > 0 ? `+${formatted}` : formatted;
}

function activeConference() {
  return state.data.conferences.find((item) => item.id === state.activeConferenceId)
    || state.data.conferences[0];
}

function render() {
  document.getElementById("app").innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">C</div>
          <h1>Conferencia<br>Estoque 4.0</h1>
          <p>Controle semanal e diario com trilha de alteracoes.</p>
        </div>
        <nav class="nav" aria-label="Navegacao principal">
          ${navButton("dashboard", "D", "Dashboard")}
          ${navButton("import", "U", "Importar PDF")}
          ${navButton("history", "H", "Historico")}
          ${navButton("stocks", "E", "Estoques")}
        </nav>
      </aside>
      <main class="content">
        ${renderPage()}
      </main>
    </div>
    <div id="toast" class="toast"></div>
  `;
  bindEvents();
  renderToast();
}

function navButton(page, icon, label) {
  return `
    <button class="${state.page === page ? "active" : ""}" data-page="${page}" type="button">
      <span class="nav-icon">${icon}</span>
      <span class="nav-label">${label}</span>
    </button>
  `;
}

function renderPage() {
  if (state.page === "import") return renderImport();
  if (state.page === "history") return renderHistory();
  if (state.page === "stocks") return renderStocks();
  if (state.page === "conference") return renderConference(activeConference());
  return renderDashboard();
}

function pageHeader(eyebrow, title, subtitle, actions = "", className = "") {
  return `
    <header class="topbar ${className}">
      <div>
        <div class="eyebrow">${eyebrow}</div>
        <h2 class="page-title">${title}</h2>
        <p class="page-subtitle">${subtitle}</p>
      </div>
      <div class="actions">${actions}</div>
    </header>
  `;
}

function renderDashboard() {
  const stocks = new Set(state.data.conferences.map((item) => item.stockName)).size;
  const pending = state.data.conferences.filter((item) => item.status === "Pendente").length;
  const divergent = state.data.conferences.reduce((sum, item) => sum + getProgress(item).divergent, 0);
  const recent = [...state.data.conferences].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);
  const actions = `
    <button class="ghost-btn" id="importBackup" type="button">Restaurar dados</button>
    <button class="ghost-btn" id="exportBackup" type="button">Salvar dados</button>
    <button class="primary-btn" data-page="import" type="button">Importar PDF</button>
    <input id="backupInput" type="file" accept="application/json,.json" hidden />
  `;

  return `
    ${pageHeader("Painel operacional", "Conferencia de estoque", "Acompanhe pendencias, divergencias e alteracoes recentes por estoque com foco em velocidade de digitacao e rastreabilidade.", actions)}
    <section class="stats-grid grid">
      ${stat("Estoques ativos", stocks)}
      ${stat("Conferencias pendentes", pending)}
      ${stat("Divergencias abertas", divergent)}
    </section>
    <section class="panel">
      <div class="panel-header">
        <h3 class="panel-title">Conferencias recentes</h3>
        <button class="ghost-btn" data-page="history" type="button">Ver historico</button>
      </div>
      ${recent.length ? recent.map(historyRow).join("") : emptyState("Nenhuma conferencia", "Para começar, importe o relatório PDF do estoque.", `<button class="primary-btn" data-page="import" type="button">Importar primeiro PDF</button>`)}
    </section>
  `;
}

function stat(label, value, key = "") {
  return `<article class="stat"><span>${label}</span><strong class="mono" ${key ? `data-stat="${key}"` : ""}>${formatIntegerDisplay(value)}</strong></article>`;
}

function metricCard(label, value, percent, color) {
  return `
    <article class="metric-card ${color}">
      <span>${label}</span>
      <strong class="mono">${formatIntegerDisplay(value)}</strong>
      <small>${percent}% do total</small>
    </article>
  `;
}

function trashIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 14h10l1-14" />
      <path d="M9 7V4h6v3" />
    </svg>
  `;
}

function renderImport() {
  return `
    ${pageHeader("Importacao", "Novo relatorio", "Selecione o PDF do estoque. Depois confira os dados e crie a conferencia.", "")}
    <section class="panel">
      <div class="import-shell">
        <div class="import-main">
          <div class="step-label"><span>1</span> Selecionar PDF</div>
          <label class="upload-zone compact-upload" id="dropZone">
            <input id="pdfInput" type="file" accept="application/pdf,.pdf" />
            <div class="upload-content">
              <div class="upload-symbol">PDF</div>
              <div>
                <h2>Arraste o PDF ou clique para selecionar</h2>
                <p>Use o relatorio do estoque. O sistema importa ID, produto, reservados, quantidade e bobinas.</p>
              </div>
            </div>
          </label>
          <div id="importPreview" class="import-preview" hidden></div>
        </div>
        <aside class="import-side">
          <div class="step-label"><span>2</span> Conferir dados</div>
          <form id="manualForm" class="import-form" aria-label="Dados do relatorio">
            <div class="field">
              <label for="stockName">Estoque</label>
              <input id="stockName" placeholder="Ex: 2.12 Estoque Material" required />
            </div>
            <div class="field">
              <label for="reportDate">Data do relatorio</label>
              <input id="reportDate" type="date" required />
            </div>
            <div class="field">
              <label for="fileName">Arquivo selecionado</label>
              <input id="fileName" placeholder="Nenhum PDF selecionado" readonly />
            </div>
          </form>
          <div class="import-checklist">
            <strong>Antes de criar</strong>
            <span>Confira se o estoque e a data estao corretos.</span>
            <span>A conferencia sera comparada com o ultimo PDF desse estoque.</span>
            <span>Se o PDF for lido corretamente, os itens aparecem na previa.</span>
          </div>
          <div class="actions import-actions">
            <button class="ghost-btn" id="demoImport" type="button">Carregar exemplo</button>
            <button class="primary-btn" id="finishImport" type="button">Criar conferencia</button>
          </div>
        </aside>
      </div>
    </section>
  `;
}

function renderHistory() {
  const conferences = [...state.data.conferences].sort((a, b) => new Date(b.reportDate) - new Date(a.reportDate));
  return `
    ${pageHeader("Historico", "Conferencias", "Consulte cada ciclo por data, status, estoque, itens e resumo de divergencias.", `<button class="primary-btn" data-page="import" type="button">Novo PDF</button>`)}
    <section class="panel">
      ${conferences.length ? conferences.map((conf) => historyRow(conf, true)).join("") : emptyState("Historico vazio", "As conferencias importadas aparecerao aqui.")}
    </section>
  `;
}

function historyRow(conf, allowDelete = false) {
  const progress = getProgress(conf);
  const metrics = getStockMetrics(conf);
  return `
    <article class="history-row">
      <div>
        <h3>${escapeHtml(conf.stockName)}</h3>
        <p>${formatDate(conf.reportDate)} · ${escapeHtml(conf.fileName || "relatorio")}</p>
      </div>
      <div class="history-metrics">
        <span class="badge ${conf.status === "Concluida" ? "green" : "gray"}">${conf.status}</span>
        <span class="badge blue">${formatIntegerDisplay(progress.counted)} conferidos</span>
        <span class="badge green">${formatIntegerDisplay(metrics.aligned)} alinhados</span>
        <span class="badge red">${formatIntegerDisplay(metrics.missing)} faltando</span>
        <span class="badge amber">${formatIntegerDisplay(metrics.surplus)} sobrando</span>
        <span class="badge gray">${formatIntegerDisplay(metrics.pending)} pendentes</span>
      </div>
      <div class="row-actions">
        <button class="ghost-btn" data-open="${conf.id}" type="button">${formatIntegerDisplay(progress.counted)}/${formatIntegerDisplay(progress.total)} itens</button>
        ${allowDelete ? `<button class="icon-btn danger-icon" data-delete-conference="${conf.id}" type="button" title="Excluir relatorio" aria-label="Excluir relatorio">${trashIcon()}</button>` : ""}
      </div>
    </article>
  `;
}

function renderStocks() {
  const groups = state.data.conferences.reduce((acc, item) => {
    acc[item.stockName] ||= [];
    acc[item.stockName].push(item);
    return acc;
  }, {});
  const stockNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));
  const selectedStock = stockNames.includes(state.activeStockName) ? state.activeStockName : stockNames[0];
  state.activeStockName = selectedStock || "";
  const selectedConferences = selectedStock ? [...groups[selectedStock]].sort((a, b) => new Date(a.reportDate) - new Date(b.reportDate)) : [];
  const latestSelected = selectedConferences.at(-1);
  const selectedMetrics = latestSelected ? getStockMetrics(latestSelected) : null;
  const rows = Object.entries(groups).map(([stock, conferences]) => {
    const ordered = [...conferences].sort((a, b) => new Date(a.reportDate) - new Date(b.reportDate));
    const totalChanged = ordered.reduce((sum, item) => sum + getProgress(item).changed, 0);
    const latest = ordered.at(-1);
    const metrics = getStockMetrics(latest);
    return `
      <article class="history-row stock-row ${stock === selectedStock ? "selected-stock" : ""}" data-stock="${escapeHtml(stock)}" tabindex="0" role="button" aria-label="Selecionar estoque ${escapeHtml(stock)}">
        <div>
          <h3>${escapeHtml(stock)}</h3>
          <p>${formatIntegerDisplay(ordered.length)} conferencias · ultima em ${formatDate(latest.reportDate)} · ${metrics.alignedPercent}% alinhado</p>
        </div>
        <div>
          <span class="badge blue">${formatIntegerDisplay(totalChanged)} alteracoes rastreadas</span>
          <span class="badge green">${formatIntegerDisplay(metrics.aligned)} alinhados</span>
          <span class="badge red">${formatIntegerDisplay(metrics.missing)} faltando</span>
          <span class="badge amber">${formatIntegerDisplay(metrics.surplus)} sobrando</span>
          <span class="badge ${latest.status === "Pendente" ? "gray" : "green"}">${latest.status}</span>
        </div>
        <div class="stock-actions">
          <button class="ghost-btn" data-open="${latest.id}" type="button">Abrir ultima</button>
          <button class="icon-btn danger-icon" data-delete-stock="${escapeHtml(stock)}" type="button" title="Excluir estoque" aria-label="Excluir estoque">${trashIcon()}</button>
        </div>
      </article>
    `;
  }).join("");

  return `
    ${pageHeader("Analise por estoque", "Resumo por estoque", "Veja alinhados, faltando, sobrando, pendentes e a trilha de mudancas de cada estoque.", "")}
    ${stockNames.length ? `
      <section class="stock-overview">
        <div class="field">
          <label for="stockSelect">Estoque</label>
          <select id="stockSelect">
            ${stockNames.map((stock) => `<option value="${escapeHtml(stock)}" ${stock === selectedStock ? "selected" : ""}>${escapeHtml(stock)}</option>`).join("")}
          </select>
        </div>
        ${latestSelected && selectedMetrics ? `
          <div class="stock-summary">
            <div>
              <strong>${escapeHtml(selectedStock)}</strong>
              <p>Ultima conferencia em ${formatDate(latestSelected.reportDate)} · ${formatIntegerDisplay(selectedConferences.length)} ciclos registrados</p>
            </div>
            <div class="stock-actions">
              <button class="primary-btn" data-open="${latestSelected.id}" type="button">Abrir conferencia</button>
              <button class="icon-btn danger-icon" data-delete-stock="${escapeHtml(selectedStock)}" type="button" title="Excluir estoque" aria-label="Excluir estoque">${trashIcon()}</button>
            </div>
          </div>
          <div class="stock-metrics">
            ${metricCard("Alinhados", selectedMetrics.aligned, selectedMetrics.alignedPercent, "green")}
            ${metricCard("Faltando", selectedMetrics.missing, selectedMetrics.missingPercent, "red")}
            ${metricCard("Sobrando", selectedMetrics.surplus, selectedMetrics.surplusPercent, "amber")}
            ${metricCard("Pendentes", selectedMetrics.pending, selectedMetrics.pendingPercent, "gray")}
          </div>
        ` : ""}
      </section>
    ` : ""}
    <section class="panel">${rows || emptyState("Sem estoques", "Importe relatorios para formar a evolucao por estoque.")}</section>
  `;
}

function getStockMetrics(conference) {
  const total = conference.rows.length || 0;
  const metrics = conference.rows.reduce((acc, row) => {
    const diff = getDiff(row);
    if (diff === null) acc.pending += 1;
    else if (diff === 0) acc.aligned += 1;
    else if (diff < 0) acc.missing += 1;
    else acc.surplus += 1;
    return acc;
  }, { aligned: 0, missing: 0, surplus: 0, pending: 0 });
  const percent = (value) => (total ? Math.round((value / total) * 100) : 0);
  return {
    ...metrics,
    alignedPercent: percent(metrics.aligned),
    missingPercent: percent(metrics.missing),
    surplusPercent: percent(metrics.surplus),
    pendingPercent: percent(metrics.pending),
  };
}

function renderConference(conf) {
  if (!conf) return renderDashboard();
  const progress = getProgress(conf);
  const rows = filteredRows(conf);
  const actions = `
    <button class="ghost-btn" data-page="import" type="button">Atualizar com PDF</button>
    <button class="ghost-btn" id="savePendingConference" type="button">Salvar pendente</button>
    <button class="icon-btn danger-icon" data-delete-conference="${conf.id}" type="button" title="Excluir relatorio" aria-label="Excluir relatorio">${trashIcon()}</button>
    <button class="primary-btn" id="finishConference" type="button" ${progress.pending ? "disabled title=\"Preencha todas as quantidades fisicas para concluir\"" : ""}>Concluir</button>
  `;

  return `
    ${pageHeader(conf.status, escapeHtml(conf.stockName), `${formatDate(conf.reportDate)} · ${formatIntegerDisplay(progress.changed)} itens mudaram desde o relatorio anterior.`, actions, "conference-header")}
    <section class="stats-grid grid compact-stats conference-stats">
      ${stat("Contados", `${formatIntegerDisplay(progress.counted)}/${formatIntegerDisplay(progress.total)}`, "counted")}
      ${stat("Itens", progress.total, "total")}
      ${stat("Pendentes", progress.pending, "pending")}
      ${stat("Divergentes", progress.divergent, "divergent")}
      ${stat("Mudancas PDF", progress.changed, "changed")}
    </section>
    <section class="panel">
      <div class="table-tools">
        <div class="segmented" role="tablist">
          ${filterButton("todos", "Todos")}
          ${filterButton("divergentes", "Divergentes")}
          ${filterButton("alterados", "Alterados")}
          ${filterButton("pendentes", "Pendentes")}
        </div>
      </div>
      <div class="table-wrap">
        <table class="conference-table">
          <colgroup>
            <col class="col-id" />
            <col class="col-product" />
            <col class="col-number" />
            <col class="col-number" />
            <col class="col-input" />
            <col class="col-diff" />
            <col class="col-status" />
            <col class="col-change" />
            <col class="col-action" />
            <col class="col-note" />
          </colgroup>
          <thead>
            <tr>
              <th>ID</th>
              <th>Produto</th>
              <th>Reservados</th>
              <th>Quantidade PDF</th>
              <th>Qtd fisica</th>
              <th>Diferenca fisica</th>
              <th>Status</th>
              <th>Mudanca no PDF</th>
              <th>Acao</th>
              <th>Observacao</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((row) => tableRow(conf, row)).join("") : `<tr><td colspan="10">${emptyState("Nada para exibir", "Ajuste os filtros ou a busca.")}</td></tr>`}
          </tbody>
        </table>
      </div>
      ${renderProductHistory(conf)}
    </section>
  `;
}

function filterButton(filter, label) {
  return `<button class="${state.filter === filter ? "active" : ""}" data-filter="${filter}" type="button">${label}</button>`;
}

function filteredRows(conf) {
  return conf.rows.filter((row) => {
    const diff = getDiff(row);
    const matchFilter =
      state.filter === "todos" ||
      (state.filter === "divergentes" && diff !== null && diff !== 0) ||
      (state.filter === "alterados" && row.movement !== "same") ||
      (state.filter === "pendentes" && diff === null);
    return matchFilter;
  });
}

function tableRow(conf, row) {
  const status = getRowStatus(row);
  const diff = getDiff(row);
  const previousQuantity = row.movement === "removed" ? Math.abs(Number(row.changedBy || 0)) : null;
  const quantityDisplay = row.quantidadeExtra !== "" && row.quantidadeExtra !== undefined
    ? `<div class="qty-stack"><span><b>Metragem:</b> ${formatIntegerDisplay(row.quantidade)}</span><small>Bobinas: ${formatIntegerDisplay(row.quantidadeExtra)}</small></div>`
    : previousQuantity
      ? `<div class="qty-stack"><span>${formatIntegerDisplay(row.quantidade)}</span><small>Antes: ${formatIntegerDisplay(previousQuantity)}</small></div>`
    : formatIntegerDisplay(row.quantidade);
  const movementLabel = row.movement === "same" ? "Sem alteracao" : row.movement === "added" ? "Adicionado" : row.movement === "removed" ? "Removido" : signed(row.changedBy);
  const movementColor = row.movement === "same" ? "gray" : row.movement === "removed" ? "red" : "blue";
  const actionLabel = row.movement === "same" ? "Conferir" : row.movement === "removed" ? "Revisar" : "Recontar";
  const actionColor = row.movement === "same" ? "gray" : "amber";
  const discreet = row.movement === "same" && state.filter === "todos" && getProgress(conf).changed > 0 ? "discreet" : "";
  return `
    <tr data-row="${conf.id}:${escapeHtml(row.id)}" class="${discreet} ${row.movement === "added" ? "added" : ""} ${row.movement === "removed" ? "removed" : ""}">
      <td class="mono">${escapeHtml(row.id)}</td>
      <td><div class="product-name">${escapeHtml(row.produto)}</div></td>
      <td class="mono">${formatIntegerDisplay(row.reservados)}</td>
      <td class="mono">${quantityDisplay}</td>
      <td><input class="table-input qty-input" inputmode="numeric" data-edit="${conf.id}:${row.id}:fisica" value="${escapeHtml(row.fisica)}" placeholder="Contar" /></td>
      <td class="delta ${diff > 0 ? "amber" : diff < 0 ? "red" : diff === 0 ? "green" : ""}" data-diff="${conf.id}:${escapeHtml(row.id)}">${diff === null ? "-" : signed(diff)}</td>
      <td data-status="${conf.id}:${escapeHtml(row.id)}"><span class="badge ${status.color}">${status.label}</span></td>
      <td><span class="badge movement ${movementColor}">${movementLabel}</span></td>
      <td>
        <div class="action-cell">
          <span class="badge ${actionColor}">${actionLabel}</span>
          <button class="link-btn" data-history="${conf.id}:${escapeHtml(row.id)}" type="button" title="Ver historico do produto">Hist.</button>
        </div>
      </td>
      <td><input class="table-input" data-edit="${conf.id}:${row.id}:observacao" value="${escapeHtml(row.observacao)}" placeholder="Motivo ou ajuste" /></td>
    </tr>
  `;
}

function renderProductHistory(conf) {
  if (!state.activeProductHistory) return "";
  const [conferenceId, rowId] = state.activeProductHistory.split(":");
  if (conferenceId !== conf.id) return "";
  const current = conf.rows.find((row) => row.id === rowId);
  if (!current) return "";
  const entries = state.data.conferences
    .filter((item) => item.stockName.toLowerCase() === conf.stockName.toLowerCase())
    .map((item) => {
      const row = item.rows.find((candidate) => candidate.id === rowId);
      if (!row) return null;
      const diff = getDiff(row);
      return { conference: item, row, diff };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.conference.reportDate) - new Date(a.conference.reportDate));

  return `
    <aside class="history-panel">
      <div>
        <strong>${escapeHtml(current.id)} · ${escapeHtml(current.produto)}</strong>
        <p>Historico de quantidade, divergencias e observacoes neste estoque.</p>
      </div>
      <div class="history-timeline">
        ${entries.map((entry) => `
          <article>
            <span>${formatDate(entry.conference.reportDate)}</span>
            <b>${formatIntegerDisplay(entry.row.quantidade)}</b>
            <em>${entry.diff === null ? "Sem contagem" : entry.diff === 0 ? "Alinhado" : `Divergencia ${signed(entry.diff)}`}</em>
            ${entry.row.observacao ? `<small>${escapeHtml(entry.row.observacao)}</small>` : ""}
          </article>
        `).join("")}
      </div>
    </aside>
  `;
}

function emptyState(title, text, action = "") {
  return `<div class="empty"><strong>${title}</strong><p>${text}</p>${action}</div>`;
}

function bindEvents() {
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => setPage(button.dataset.page));
  });
  document.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => setActiveConference(button.dataset.open));
  });
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      render();
    });
  });
  document.querySelectorAll(".stock-row[data-stock]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      state.activeStockName = row.dataset.stock;
      render();
    });
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      state.activeStockName = row.dataset.stock;
      render();
    });
  });
  document.querySelectorAll("[data-delete-stock]").forEach((button) => {
    button.addEventListener("click", () => deleteStock(button.dataset.deleteStock));
  });
  document.querySelectorAll("[data-delete-conference]").forEach((button) => {
    button.addEventListener("click", () => deleteConference(button.dataset.deleteConference));
  });
  const stockSelect = document.getElementById("stockSelect");
  if (stockSelect) {
    stockSelect.addEventListener("change", () => {
      state.activeStockName = stockSelect.value;
      render();
    });
  }
  document.querySelectorAll("[data-history]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeProductHistory = state.activeProductHistory === button.dataset.history ? null : button.dataset.history;
      render();
    });
  });
  document.querySelectorAll("[data-edit]").forEach((input) => {
    input.addEventListener("input", () => updateCell(input.dataset.edit, input.value));
    input.addEventListener("keydown", moveOnEnter);
  });

  const savePendingConference = document.getElementById("savePendingConference");
  if (savePendingConference) {
    savePendingConference.addEventListener("click", () => {
      const conf = activeConference();
      conf.status = "Pendente";
      saveData();
      showToast("Conferencia salva como pendente.");
      render();
    });
  }

  const finishConference = document.getElementById("finishConference");
  if (finishConference) {
    finishConference.addEventListener("click", () => {
      const conf = activeConference();
      if (getProgress(conf).pending > 0) {
        showToast("Preencha todas as quantidades fisicas antes de concluir.");
        return;
      }
      conf.status = "Concluida";
      saveData();
      showToast("Conferencia concluida.");
      render();
    });
  }

  bindBackupEvents();
  bindImportEvents();
}

function deleteConference(id) {
  const conference = state.data.conferences.find((item) => item.id === id);
  if (!conference) return;
  const confirmed = window.confirm(`Excluir o relatorio de ${conference.stockName} em ${formatDate(conference.reportDate)}?`);
  if (!confirmed) return;

  state.data.conferences = state.data.conferences.filter((item) => item.id !== id);
  if (state.activeConferenceId === id) state.activeConferenceId = null;
  saveData();
  showToast("Relatorio excluido.");

  if (state.page === "conference") navigateToPage("history");
  else render();
}

function deleteStock(stockName) {
  const total = state.data.conferences.filter((item) => item.stockName === stockName).length;
  if (!total) return;
  const confirmed = window.confirm(`Excluir o estoque "${stockName}" e seus ${total} relatorios?`);
  if (!confirmed) return;

  state.data.conferences = state.data.conferences.filter((item) => item.stockName !== stockName);
  if (state.activeStockName === stockName) state.activeStockName = "";
  const active = state.data.conferences.find((item) => item.id === state.activeConferenceId);
  if (!active) state.activeConferenceId = null;
  saveData();
  showToast("Estoque excluido.");

  if (state.page === "conference") navigateToPage("stocks");
  else render();
}

function bindBackupEvents() {
  const exportBackup = document.getElementById("exportBackup");
  const importBackup = document.getElementById("importBackup");
  const backupInput = document.getElementById("backupInput");

  exportBackup?.addEventListener("click", exportDataBackup);
  importBackup?.addEventListener("click", () => backupInput?.click());
  backupInput?.addEventListener("change", () => importDataBackup(backupInput.files?.[0]));
}

function exportDataBackup() {
  const payload = createBackupPayload(state.data);
  const fileName = `conferencia-estoque-backup-${new Date().toISOString().slice(0, 10)}.json`;
  downloadJson(payload, fileName);
  showToast("Arquivo de dados baixado.");
}

async function importDataBackup(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const data = payload.data || payload;
    if (!Array.isArray(data.conferences)) throw new Error("Formato invalido");
    state.data = {
      conferences: data.conferences.map((conference) => ({
        ...conference,
        rows: Array.isArray(conference.rows) ? conference.rows.map(normalizeRow) : [],
      })),
    };
    state.activeConferenceId = null;
    state.page = "dashboard";
    saveData();
    showToast("Dados restaurados com sucesso.");
    render();
  } catch {
    showToast("Arquivo invalido. Selecione um backup JSON do sistema.");
  }
}

function updateCell(key, value) {
  const [conferenceId, rowId, field] = key.split(":");
  const conf = state.data.conferences.find((item) => item.id === conferenceId);
  const row = conf?.rows.find((item) => item.id === rowId);
  if (!row) return;
  row[field] = field === "fisica" ? value.replace(/[^\d.-]/g, "") : value;
  conf.status = getProgress(conf).pending === 0 ? "Concluida" : "Pendente";
  saveData();
  updateLiveRow(conf, row);
  updateLiveBadges(conf);
}

function updateLiveRow(conf, row) {
  const selectorId = CSS.escape(`${conf.id}:${row.id}`);
  const diffCell = document.querySelector(`[data-diff="${selectorId}"]`);
  const statusCell = document.querySelector(`[data-status="${selectorId}"]`);
  if (!diffCell || !statusCell) return;
  const diff = getDiff(row);
  const status = getRowStatus(row);
  diffCell.textContent = diff === null ? "-" : signed(diff);
  diffCell.classList.toggle("amber", diff > 0);
  diffCell.classList.toggle("red", diff < 0);
  diffCell.classList.toggle("green", diff === 0);
  statusCell.innerHTML = `<span class="badge ${status.color}">${status.label}</span>`;
}

function updateLiveBadges(conf) {
  const progress = getProgress(conf);
  const subtitle = document.querySelector(".page-subtitle");
  if (subtitle) subtitle.textContent = `${formatDate(conf.reportDate)} · ${formatIntegerDisplay(progress.changed)} itens mudaram desde o relatorio anterior.`;
  const eyebrow = document.querySelector(".eyebrow");
  if (eyebrow) eyebrow.textContent = conf.status;
  const finishButton = document.getElementById("finishConference");
  if (finishButton) {
    finishButton.textContent = "Concluir";
    finishButton.disabled = progress.pending > 0;
    finishButton.title = progress.pending > 0 ? "Preencha todas as quantidades fisicas para concluir" : "";
  }
  const totalStat = document.querySelector('[data-stat="total"]');
  const countedStat = document.querySelector('[data-stat="counted"]');
  const pendingStat = document.querySelector('[data-stat="pending"]');
  const divergentStat = document.querySelector('[data-stat="divergent"]');
  const changedStat = document.querySelector('[data-stat="changed"]');
  if (countedStat) countedStat.textContent = `${formatIntegerDisplay(progress.counted)}/${formatIntegerDisplay(progress.total)}`;
  if (totalStat) totalStat.textContent = formatIntegerDisplay(progress.total);
  if (pendingStat) pendingStat.textContent = formatIntegerDisplay(progress.pending);
  if (divergentStat) divergentStat.textContent = formatIntegerDisplay(progress.divergent);
  if (changedStat) changedStat.textContent = formatIntegerDisplay(progress.changed);
}

function moveOnEnter(event) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const inputs = [...document.querySelectorAll(".qty-input")];
  const index = inputs.indexOf(event.currentTarget);
  const next = inputs[index + 1];
  if (next) {
    next.focus();
    next.select();
  }
}

function bindImportEvents() {
  const dropZone = document.getElementById("dropZone");
  const pdfInput = document.getElementById("pdfInput");
  const demoImport = document.getElementById("demoImport");
  const finishImport = document.getElementById("finishImport");
  if (!dropZone || !pdfInput) return;

  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
    handleFile(event.dataTransfer.files[0]);
  });
  pdfInput.addEventListener("change", () => handleFile(pdfInput.files[0]));

  demoImport?.addEventListener("click", () => {
    document.getElementById("stockName").value = "2.12 Estoque Material";
    document.getElementById("reportDate").value = new Date().toISOString().slice(0, 10);
    document.getElementById("fileName").value = "05-07-2026 - 2.12 Estoque Material.pdf";
    state.importRows = parseRows(seedRows.map((row, index) => {
      const quantity = row.quantidade + [1, 0, -5, 0, 3, 0, 0, -2][index];
      return `${row.id} | ${row.produto} | ${row.reservados} | ${quantity}`;
    }).join("\n") + "\n1009 | Banco bistro preto | 0 | 24");
    setImportPreview(`${state.importRows.length} itens prontos para conferencia.`);
    showToast("Exemplo carregado.");
  });

  finishImport?.addEventListener("click", finishImportFlow);
}

async function handleFile(file) {
  if (!file) return;
  state.importRows = [];
  document.getElementById("fileName").value = file.name;
  setImportPreview("Lendo PDF...");
  const meta = parseFileMeta(file.name);
  document.getElementById("stockName").value = meta.stockName;
  document.getElementById("reportDate").value = meta.reportDate;

  try {
    const text = await readPdfText(file);
    const pdfMeta = parsePdfMeta(text, meta);
    document.getElementById("stockName").value = pdfMeta.stockName;
    document.getElementById("reportDate").value = pdfMeta.reportDate;
    const rows = parseRows(text);
    if (rows.length) {
      state.importRows = rows;
      setImportPreview(`${rows.length} itens reconhecidos. Confira estoque e data antes de criar a conferencia.`);
      showToast(`${rows.length} itens extraidos do PDF.`);
    } else {
      setImportPreview("Nenhum item reconhecido neste PDF. Verifique se o arquivo e textual e segue o modelo do relatorio.");
      showToast("PDF lido, mas a tabela nao foi identificada.");
    }
  } catch (error) {
    setImportPreview(`Falha na leitura automatica: ${error.message || "erro desconhecido"}`);
    showToast("Nao foi possivel ler o PDF automaticamente.");
  }
}

function setImportPreview(message) {
  const preview = document.getElementById("importPreview");
  if (!preview) return;
  preview.hidden = !message;
  preview.textContent = message || "";
}

function finishImportFlow() {
  const stockName = document.getElementById("stockName").value.trim();
  const reportDate = document.getElementById("reportDate").value;
  const fileName = document.getElementById("fileName").value || "relatorio.pdf";
  const rows = state.importRows;
  if (!stockName || !reportDate || !rows.length) {
    showToast("Selecione um PDF valido antes de criar a conferencia.");
    return;
  }

  const previous = latestByStock(stockName);
  const conference = createConference({ stockName, reportDate, fileName, rows }, previous);
  state.data.conferences.unshift(conference);
  saveData();
  state.importRows = [];
  showToast(previous ? "Relatorio mesclado e comparado ao anterior." : "Primeira conferencia criada.");
  navigateToConference(conference.id);
}

function renderToast() {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = state.toast;
  toast.classList.toggle("show", Boolean(state.toast));
}

window.addEventListener("hashchange", applyRouteFromHash);

if (!window.location.hash) {
  window.history.replaceState(null, "", "#dashboard");
}

applyRouteFromHash();
