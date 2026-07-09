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
  activeStockName: "",
  importRows: [],
  importMeta: null,
  importing: false,
  toast: "",
  data: hydrateStoredData(loadData()),
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

function hydrateStoredData(data) {
  return {
    conferences: (data.conferences || []).map((conference) => {
      const fileMeta = conference.fileName ? parseFileMeta(conference.fileName) : {};
      const reportTime = conference.reportTime || timeFromDateTime(conference.reportDateTime) || fileMeta.reportTime || "";
      return {
        ...conference,
        reportTime,
        reportDateTime: conference.reportDateTime || buildReportDateTime(conference.reportDate, reportTime),
      };
    }),
  };
}

function createConference(report, previous) {
  const previousRows = new Map((previous?.rows || []).map((row) => [String(row.id), row]));
  const incomingIds = new Set(report.rows.map((row) => String(row.id)));

  const rows = report.rows.map((row) => {
    const old = previousRows.get(String(row.id));
    const changedBy = old ? Number(row.quantidade) - Number(old.quantidade) : 0;
    const preservedPhysical = old && old.fisica !== "" ? old.fisica : "";
    const preservedObs = old && old.observacao && changedBy === 0 ? old.observacao : "";
    const hasIncomingPhysical = row.fisica !== undefined && row.fisica !== null && row.fisica !== "";
    const physical = hasIncomingPhysical ? row.fisica : preservedPhysical;
    const inheritedPhysical = !hasIncomingPhysical && preservedPhysical !== "";
    return normalizeRow({
      ...row,
      fisica: physical,
      fisicaHerdada: inheritedPhysical,
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
        fisicaHerdada: old.fisica !== "" && old.fisica !== null && old.fisica !== undefined,
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
    reportTime: report.reportTime || "",
    reportDateTime: report.reportDateTime || buildReportDateTime(report.reportDate, report.reportTime),
    fileName: report.fileName,
    createdAt: new Date().toISOString(),
    status: "Pendente",
    rows,
  };
  conference.status = canCompleteConference(conference) ? "Concluida" : "Pendente";
  return conference;
}

function latestByStock(stockName) {
  return state.data.conferences
    .filter((item) => item.stockName.toLowerCase() === stockName.toLowerCase())
    .sort((a, b) => new Date(getReportDateTime(b)) - new Date(getReportDateTime(a)))[0];
}

function buildReportDateTime(reportDate, reportTime = "") {
  const date = reportDate || new Date().toISOString().slice(0, 10);
  return reportTime ? `${date}T${reportTime}` : `${date}T00:00:00`;
}

function getReportDateTime(conference) {
  return conference.reportDateTime || buildReportDateTime(conference.reportDate, conference.reportTime);
}

function formatReportDateTime(conference) {
  const date = formatDate(conference.reportDate);
  const time = getReportTime(conference);
  return time ? `${date} ${time}` : date;
}

function getReportTime(conference) {
  return conference.reportTime || timeFromDateTime(conference.reportDateTime);
}

function canCompleteConference(conference) {
  const progress = getProgress(conference);
  return progress.pending === 0 && progress.inherited === 0;
}

function completionBlockMessage(progress) {
  if (progress.inherited > 0) return "Revise as quantidades fisicas herdadas para concluir";
  if (progress.pending > 0) return "Preencha todas as quantidades fisicas para concluir";
  return "";
}

function timeFromDateTime(value) {
  const match = String(value || "").match(/T(\d{2}:\d{2}(?::\d{2})?)/);
  if (!match || match[1] === "00:00:00" || match[1] === "00:00") return "";
  return match[1].length === 5 ? `${match[1]}:00` : match[1];
}

function setPage(page) {
  navigateToPage(page);
}

function applyPage(page) {
  state.page = page;
  state.filter = "todos";
  render();
}

function setActiveConference(id, filter = "todos") {
  navigateToConference(id, filter);
}

function applyActiveConference(id, filter = "todos") {
  state.activeConferenceId = id;
  state.page = "conference";
  state.filter = ["todos", "divergentes", "recontar", "pendentes"].includes(filter) ? filter : "todos";
  render();
}

function navigateToPage(page) {
  const route = ROUTES[page] || ROUTES.dashboard;
  setHash(`#${route}`);
}

function navigateToConference(id, filter = "todos") {
  const suffix = filter && filter !== "todos" ? `/${encodeURIComponent(filter)}` : "";
  setHash(`#conferencia/${encodeURIComponent(id)}${suffix}`);
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
  const [route, id, filter] = hash.split("/");

  if (route === "conferencia" && id) {
    const exists = state.data.conferences.some((item) => item.id === id);
    if (exists) {
      applyActiveConference(id, filter);
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
  const latestConferences = latestConferencesByStock();
  const stocks = latestConferences.length;
  const totals = latestConferences.reduce((acc, conf) => {
    const progress = getProgress(conf);
    acc.importedToday += isReportToday(conf) ? 1 : 0;
    acc.withoutToday += isReportToday(conf) ? 0 : 1;
    acc.toReview += getReviewCount(conf);
    acc.toCount += getEmptyCount(conf);
    acc.divergent += progress.divergent;
    acc.changed += progress.changed;
    return acc;
  }, { importedToday: 0, withoutToday: 0, toReview: 0, toCount: 0, divergent: 0, changed: 0 });
  const recentReports = [...state.data.conferences]
    .sort((a, b) => new Date(getReportDateTime(b)) - new Date(getReportDateTime(a)))
    .slice(0, 5);
  const actions = `
    <button class="ghost-btn" id="importBackup" type="button">Restaurar backup</button>
    <button class="ghost-btn" id="exportBackup" type="button">Backup completo</button>
    <button class="primary-btn" data-page="stocks" type="button">Importar relatorio</button>
    <input id="backupInput" type="file" accept="application/json,.json" hidden />
  `;

  return `
    ${pageHeader("Rotina do dia", "Conferencia de estoque", "Importe os relatorios da manha e resolva primeiro o que mudou, falta contar ou esta com diferenca.", actions)}
    <section class="stats-grid grid dashboard-stats">
      ${stat("Importados hoje", totals.importedToday)}
      ${stat("Sem relatorio hoje", totals.withoutToday)}
      ${stat("Para revisar", totals.toReview)}
      ${stat("Para contar", totals.toCount)}
      ${stat("Com diferenca", totals.divergent)}
      ${stat("Mudou no sistema", totals.changed)}
    </section>
    <section class="panel dashboard-panel">
      <div class="dashboard-section-header">
        <div>
          <strong>Status dos estoques</strong>
          <span>${formatIntegerDisplay(stocks)} estoque${stocks === 1 ? "" : "s"} com relatorio atual</span>
        </div>
      </div>
      <div class="dashboard-stock-list">
        ${latestConferences.length ? latestConferences
          .sort((a, b) => getDashboardNeedScore(b) - getDashboardNeedScore(a) || a.stockName.localeCompare(b.stockName))
          .map(dashboardStockRow)
          .join("") : emptyState("Nenhum estoque ainda", "Importe um relatorio para acompanhar o status dos estoques.")}
      </div>
    </section>
    <section class="panel dashboard-panel">
      <div class="dashboard-section-header">
        <div>
          <strong>Ultimos relatorios</strong>
          <span>Importacoes mais recentes</span>
        </div>
      </div>
      <div class="dashboard-report-list">
        ${recentReports.length ? recentReports.map(dashboardReportRow).join("") : emptyState("Sem relatorios", "Os ultimos relatorios importados aparecerao aqui.")}
      </div>
    </section>
  `;
}

function latestConferencesByStock() {
  const groups = state.data.conferences.reduce((acc, item) => {
    acc[item.stockName] ||= [];
    acc[item.stockName].push(item);
    return acc;
  }, {});
  return Object.values(groups).map((items) => [...items]
    .sort((a, b) => new Date(getReportDateTime(b)) - new Date(getReportDateTime(a)))[0]);
}

function getEmptyCount(conference) {
  return conference.rows.filter((row) => getDiff(row) === null).length;
}

function getReviewCount(conference) {
  return conference.rows.filter((row) => row.fisicaHerdada || row.movement !== "same").length;
}

function isReportToday(conference) {
  return getReportDateTime(conference).slice(0, 10) === todayKey();
}

function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDashboardNeedScore(conference) {
  const progress = getProgress(conference);
  return (isReportToday(conference) ? 0 : 5000) + (getReviewCount(conference) * 1000) + (getEmptyCount(conference) * 800) + (progress.divergent * 500);
}

function getPriorityFilter(conference) {
  if (getReviewCount(conference)) return "recontar";
  if (getEmptyCount(conference)) return "pendentes";
  const progress = getProgress(conference);
  if (progress.divergent) return "divergentes";
  return "todos";
}

function getDailyStockStatus(conference) {
  if (!isReportToday(conference)) return { label: "Nao importado hoje", color: "amber" };
  if (getReviewCount(conference)) return { label: "A revisar", color: "blue" };
  if (getEmptyCount(conference)) return { label: "Sem contagem", color: "gray" };
  if (getProgress(conference).divergent) return { label: "Com diferenca", color: "red" };
  return { label: "Concluido", color: "green" };
}

function getStockTone(stockName) {
  const names = latestConferencesByStock().map((item) => item.stockName).sort((a, b) => a.localeCompare(b));
  const index = Math.max(0, names.indexOf(stockName));
  return `stock-tone-${(index % 4) + 1}`;
}

function dashboardStockRow(conf) {
  const progress = getProgress(conf);
  const metrics = getStockMetrics(conf);
  const empty = getEmptyCount(conf);
  const review = getReviewCount(conf);
  const filter = getPriorityFilter(conf);
  const dailyStatus = getDailyStockStatus(conf);
  return `
    <article class="dashboard-stock-row stock-tone ${getStockTone(conf.stockName)}">
      <div>
        <h3>${escapeHtml(conf.stockName)}</h3>
        <p>${formatReportDateTime(conf)} · ${reportAgeText(conf)}</p>
      </div>
      <div class="history-metrics">
        <span class="badge ${dailyStatus.color}">${dailyStatus.label}</span>
        <span class="badge blue">${formatIntegerDisplay(review)} revisar</span>
        <span class="badge gray">${formatIntegerDisplay(empty)} a contar</span>
        <span class="badge red">${formatIntegerDisplay(progress.divergent)} com diferenca</span>
        <span class="badge blue">${formatIntegerDisplay(progress.changed)} mudou sistema</span>
        <span class="badge green">${formatIntegerDisplay(metrics.aligned)} alinhados</span>
      </div>
      <button class="ghost-btn" data-open="${conf.id}" data-open-filter="${filter}" type="button">Abrir</button>
    </article>
  `;
}

function dashboardReportRow(conf) {
  const progress = getProgress(conf);
  const filter = getPriorityFilter(conf);
  const review = getReviewCount(conf);
  return `
    <article class="dashboard-report-row">
      <div>
        <strong>${escapeHtml(conf.stockName)}</strong>
        <span>${formatReportDateTime(conf)} · ${escapeHtml(conf.fileName || "relatorio")}</span>
      </div>
      <div class="history-metrics">
        <span class="badge ${conf.status === "Concluida" ? "green" : "gray"}">${conf.status}</span>
        <span class="badge blue">${formatIntegerDisplay(review)} revisar</span>
        <span class="badge gray">${formatIntegerDisplay(getEmptyCount(conf))} sem contagem</span>
        <span class="badge red">${formatIntegerDisplay(progress.divergent)} com diferenca</span>
      </div>
      <button class="ghost-btn" data-open="${conf.id}" data-open-filter="${filter}" type="button">Abrir</button>
    </article>
  `;
}

function reportAgeText(conf) {
  const date = new Date(getReportDateTime(conf));
  const now = new Date();
  const days = Math.max(0, Math.floor((now - date) / 86400000));
  if (days === 0) return "relatorio de hoje";
  if (days === 1) return "ha 1 dia";
  return `ha ${formatIntegerDisplay(days)} dias`;
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
  const conferences = [...state.data.conferences].sort((a, b) => new Date(getReportDateTime(b)) - new Date(getReportDateTime(a)));
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
        <p>${formatReportDateTime(conf)} · ${escapeHtml(conf.fileName || "relatorio")}</p>
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
  const selectedStock = stockNames.includes(state.activeStockName) ? state.activeStockName : "";
  state.activeStockName = selectedStock || "";
  const rows = stockNames.map((stock, index) => {
    const conferences = groups[stock];
    const ordered = [...conferences].sort((a, b) => new Date(getReportDateTime(a)) - new Date(getReportDateTime(b)));
    const stockHistory = [...ordered].reverse();
    const totalChanged = ordered.reduce((sum, item) => sum + getProgress(item).changed, 0);
    const latest = ordered.at(-1);
    const metrics = getStockMetrics(latest);
    return `
      <div class="stock-group stock-tone stock-tone-${(index % 4) + 1} ${stock === selectedStock ? "expanded" : ""}" data-stock-group="${escapeHtml(stock)}">
        <article class="history-row stock-row ${stock === selectedStock ? "selected-stock" : ""}" data-stock="${escapeHtml(stock)}" tabindex="0" role="button" aria-label="Selecionar estoque ${escapeHtml(stock)}">
          <div>
            <h3>${escapeHtml(stock)}</h3>
            <p>${formatIntegerDisplay(ordered.length)} conferencias · ultima em ${formatReportDateTime(latest)} · ${metrics.alignedPercent}% alinhado</p>
          </div>
          <div>
            <span class="badge blue">${formatIntegerDisplay(totalChanged)} alteracoes rastreadas</span>
            <span class="badge green">${formatIntegerDisplay(metrics.aligned)} alinhados</span>
            <span class="badge red">${formatIntegerDisplay(metrics.missing)} faltando</span>
            <span class="badge amber">${formatIntegerDisplay(metrics.surplus)} sobrando</span>
            <span class="badge ${latest.status === "Pendente" ? "gray" : "green"}">${latest.status}</span>
          </div>
          <div class="stock-actions">
            <button class="icon-btn danger-icon" data-delete-stock="${escapeHtml(stock)}" type="button" title="Excluir estoque" aria-label="Excluir estoque">${trashIcon()}</button>
          </div>
        </article>
        ${renderStockHistory(stockHistory)}
      </div>
    `;
  }).join("");
  const actions = `
    <button class="primary-btn" id="stockImportButton" type="button">${stockNames.length ? "Novo relatorio" : "Importar relatorio"}</button>
    <input id="stockPdfInput" type="file" accept="application/pdf,.pdf" multiple hidden />
  `;

  return `
    ${pageHeader("Analise por estoque", "Resumo por estoque", "Veja alinhados, faltando, sobrando, pendentes e a trilha de mudancas de cada estoque.", actions)}
    <section class="panel">${rows || emptyState("Nenhum estoque ainda", "Os estoques aparecem automaticamente depois que voce importa um ou mais relatorios PDF.", `<button class="primary-btn" id="emptyStockImportButton" type="button">Importar relatorio</button>`)}</section>
  `;
}

function renderStockHistory(conferences) {
  return `
    <div class="stock-history">
      <div class="stock-history-inner">
        <div class="stock-history-header">
          <strong>Historico de relatorios</strong>
          <span>${formatIntegerDisplay(conferences.length)} registros deste estoque</span>
        </div>
        <div class="stock-history-list">
          ${conferences.map(stockHistoryRow).join("")}
        </div>
      </div>
    </div>
  `;
}

function stockHistoryRow(conf) {
  const progress = getProgress(conf);
  const metrics = getStockMetrics(conf);
  return `
    <article class="stock-history-row">
      <div>
        <strong>${formatReportDateTime(conf)}</strong>
        <span>${escapeHtml(conf.fileName || "relatorio")}</span>
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
        <button class="ghost-btn" data-open="${conf.id}" type="button">Abrir</button>
        <button class="icon-btn danger-icon" data-delete-conference="${conf.id}" type="button" title="Excluir relatorio" aria-label="Excluir relatorio">${trashIcon()}</button>
      </div>
    </article>
  `;
}

function getStockMetrics(conference) {
  const total = conference.rows.length || 0;
  const metrics = conference.rows.reduce((acc, row) => {
    const diff = getDiff(row);
    if (diff === null || row.fisicaHerdada) acc.pending += 1;
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
  const review = getReviewCount(conf);
  const rows = filteredRows(conf);
  const blockMessage = completionBlockMessage(progress);
  const actions = `
    <button class="ghost-btn" data-page="import" type="button">Atualizar com PDF</button>
    <button class="ghost-btn" id="savePendingConference" type="button">Salvar pendente</button>
    <button class="icon-btn danger-icon" data-delete-conference="${conf.id}" type="button" title="Excluir relatorio" aria-label="Excluir relatorio">${trashIcon()}</button>
    <button class="primary-btn" id="finishConference" type="button" ${blockMessage ? `disabled title="${blockMessage}"` : ""}>Concluir</button>
  `;

  return `
    ${pageHeader(conf.status, escapeHtml(conf.stockName), `${formatReportDateTime(conf)} · ${formatIntegerDisplay(progress.changed)} mudancas no sistema desde o relatorio anterior.`, actions, "conference-header")}
    <section class="stats-grid grid compact-stats conference-stats">
      ${stat("Contados", `${formatIntegerDisplay(progress.counted)}/${formatIntegerDisplay(progress.total)}`, "counted")}
      ${stat("A revisar", review, "review")}
      ${stat("Com diferenca", progress.divergent, "divergent")}
      ${stat("Sem contagem", getEmptyCount(conf), "empty")}
    </section>
    <section class="panel">
      <div class="table-tools">
        ${progress.inherited ? `<button class="ghost-btn compact-action" data-confirm-all-inherited="${conf.id}" type="button">Confirmar herdadas</button>` : "<span></span>"}
        <div class="segmented" role="tablist">
          ${filterButton("todos", "Todos")}
          ${filterButton("recontar", "Revisar")}
          ${filterButton("divergentes", "Com diferenca")}
          ${filterButton("pendentes", "Sem contagem")}
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
          </colgroup>
          <thead>
            <tr>
              <th>ID</th>
              <th>Produto</th>
              <th>Reserv.</th>
              <th>Qtd Sistema</th>
              <th>Qtd fisica</th>
              <th>Dif. fisica</th>
              <th>Status</th>
              <th>Mudou Sistema</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((row) => tableRow(conf, row)).join("") : `<tr><td colspan="8">${emptyState("Nada para exibir", "Ajuste os filtros ou a busca.")}</td></tr>`}
          </tbody>
        </table>
      </div>
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
      (state.filter === "recontar" && (row.movement !== "same" || row.fisicaHerdada)) ||
      (state.filter === "pendentes" && diff === null);
    return matchFilter;
  });
}

function tableRow(conf, row) {
  const status = getRowStatus(row);
  const diff = getDiff(row);
  const previousQuantity = row.movement === "removed" ? Math.abs(Number(row.changedBy || 0)) : null;
  const quantityDisplay = row.quantidadeExtra !== "" && row.quantidadeExtra !== undefined
    ? `<div class="qty-stack"><span>${formatIntegerDisplay(row.quantidade)}</span><small>Bobinas: ${formatIntegerDisplay(row.quantidadeExtra)}</small></div>`
    : previousQuantity
      ? `<div class="qty-stack"><span>${formatIntegerDisplay(row.quantidade)}</span><small>Antes: ${formatIntegerDisplay(previousQuantity)}</small></div>`
    : formatIntegerDisplay(row.quantidade);
  const movementLabel = row.movement === "same" ? "Sem alteracao" : row.movement === "added" ? "Adicionado" : row.movement === "removed" ? "Removido" : signed(row.changedBy);
  const movementColor = row.movement === "same" ? "gray" : row.movement === "removed" ? "red" : "blue";
  const changed = row.movement === "changed" ? "changed" : "";
  const inherited = row.fisicaHerdada ? "inherited" : "";
  return `
    <tr data-row="${conf.id}:${escapeHtml(row.id)}" class="${changed} ${inherited} ${row.movement === "added" ? "added" : ""} ${row.movement === "removed" ? "removed" : ""}">
      <td class="mono">${escapeHtml(row.id)}</td>
      <td><div class="product-name">${escapeHtml(row.produto)}</div></td>
      <td class="mono">${formatIntegerDisplay(row.reservados)}</td>
      <td class="mono">${quantityDisplay}</td>
      <td>
        <div class="physical-cell">
          <input class="table-input qty-input ${row.fisicaHerdada ? "inherited-input" : ""}" inputmode="numeric" data-edit="${conf.id}:${row.id}:fisica" value="${escapeHtml(row.fisica)}" placeholder="Contar" />
          ${row.fisicaHerdada ? `<button class="confirm-inherited" data-confirm-inherited="${conf.id}:${escapeHtml(row.id)}" type="button" title="Confirmar quantidade herdada">OK</button>` : ""}
        </div>
      </td>
      <td class="delta ${diff > 0 ? "amber" : diff < 0 ? "red" : diff === 0 ? "green" : ""}" data-diff="${conf.id}:${escapeHtml(row.id)}">${diff === null ? "-" : signed(diff)}</td>
      <td data-status="${conf.id}:${escapeHtml(row.id)}"><span class="badge ${status.color}">${status.label}</span></td>
      <td><span class="badge movement ${movementColor}">${movementLabel}</span></td>
    </tr>
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
    button.addEventListener("click", () => setActiveConference(button.dataset.open, button.dataset.openFilter || "todos"));
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
      toggleStockHistory(row.dataset.stock);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleStockHistory(row.dataset.stock);
    });
  });
  document.querySelectorAll("[data-delete-stock]").forEach((button) => {
    button.addEventListener("click", () => deleteStock(button.dataset.deleteStock));
  });
  document.querySelectorAll("[data-delete-conference]").forEach((button) => {
    button.addEventListener("click", () => deleteConference(button.dataset.deleteConference));
  });
  const stockPdfInput = document.getElementById("stockPdfInput");
  const openStockImport = () => stockPdfInput?.click();
  document.getElementById("stockImportButton")?.addEventListener("click", openStockImport);
  document.getElementById("emptyStockImportButton")?.addEventListener("click", openStockImport);
  stockPdfInput?.addEventListener("change", async () => {
    await importStockPdfFiles([...stockPdfInput.files]);
    stockPdfInput.value = "";
  });
  document.querySelectorAll("[data-confirm-inherited]").forEach((button) => {
    button.addEventListener("click", () => confirmInheritedPhysical(button.dataset.confirmInherited));
  });
  document.querySelectorAll("[data-confirm-all-inherited]").forEach((button) => {
    button.addEventListener("click", () => confirmAllInheritedPhysical(button.dataset.confirmAllInherited));
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
      const progress = getProgress(conf);
      if (progress.inherited > 0) {
        showToast("Revise as quantidades fisicas herdadas antes de concluir.");
        return;
      }
      if (progress.pending > 0) {
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

function toggleStockHistory(stockName) {
  if (state.activeStockName !== stockName) {
    state.activeStockName = stockName;
    render();
    return;
  }

  const group = document.querySelector(`[data-stock-group="${CSS.escape(stockName)}"]`);
  if (!group) {
    state.activeStockName = "";
    render();
    return;
  }

  group.classList.add("closing");
  setTimeout(() => {
    state.activeStockName = "";
    render();
  }, 220);
}

function deleteConference(id) {
  const conference = state.data.conferences.find((item) => item.id === id);
  if (!conference) return;
  const confirmed = window.confirm(`Excluir o relatorio de ${conference.stockName} em ${formatReportDateTime(conference)}?`);
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

async function importStockPdfFiles(files) {
  const pdfs = files.filter((file) => /\.pdf$/i.test(file.name) || file.type === "application/pdf");
  if (!pdfs.length) return;

  let imported = 0;
  let lastConference = null;
  showToast(`Importando ${pdfs.length} relatorio${pdfs.length > 1 ? "s" : ""}...`);

  for (const file of pdfs) {
    try {
      const conference = await importConferenceFromPdf(file);
      if (conference) {
        imported += 1;
        lastConference = conference;
      }
    } catch (error) {
      console.error(error);
    }
  }

  if (!imported) {
    showToast("Nenhum relatorio valido foi importado.");
    render();
    return;
  }

  saveData();
  state.activeStockName = lastConference.stockName;
  showToast(`${imported} relatorio${imported > 1 ? "s" : ""} importado${imported > 1 ? "s" : ""}.`);
  render();
}

async function importConferenceFromPdf(file) {
  const fallback = parseFileMeta(file.name);
  const text = await readPdfText(file);
  const meta = parsePdfMeta(text, fallback);
  const rows = parseRows(text);
  if (!rows.length) return null;

  const previous = latestByStock(meta.stockName);
  const conference = createConference({
    stockName: meta.stockName,
    reportDate: meta.reportDate,
    reportTime: meta.reportTime,
    reportDateTime: meta.reportDateTime,
    fileName: file.name,
    rows,
  }, previous);
  state.data.conferences.unshift(conference);
  return conference;
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
  showToast("Backup completo baixado.");
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
  if (field === "fisica") row.fisicaHerdada = false;
  persistRowReview(conf, row);
}

function confirmInheritedPhysical(key) {
  const [conferenceId, rowId] = key.split(":");
  const conf = state.data.conferences.find((item) => item.id === conferenceId);
  const row = conf?.rows.find((item) => item.id === rowId);
  if (!row || !row.fisicaHerdada) return;
  row.fisicaHerdada = false;
  persistRowReview(conf, row);
}

function confirmAllInheritedPhysical(conferenceId) {
  const conf = state.data.conferences.find((item) => item.id === conferenceId);
  if (!conf) return;
  const inheritedRows = conf.rows.filter((row) => row.fisicaHerdada);
  if (!inheritedRows.length) return;

  inheritedRows.forEach((row) => {
    row.fisicaHerdada = false;
  });
  conf.status = canCompleteConference(conf) ? "Concluida" : "Pendente";
  saveData();
  showToast(`${formatIntegerDisplay(inheritedRows.length)} quantidade${inheritedRows.length === 1 ? "" : "s"} herdada${inheritedRows.length === 1 ? "" : "s"} confirmada${inheritedRows.length === 1 ? "" : "s"}.`);
  render();
}

function persistRowReview(conf, row) {
  conf.status = canCompleteConference(conf) ? "Concluida" : "Pendente";
  saveData();
  updateLiveRow(conf, row);
  updateLiveBadges(conf);
}

function updateLiveRow(conf, row) {
  const selectorId = CSS.escape(`${conf.id}:${row.id}`);
  const rowElement = document.querySelector(`[data-row="${selectorId}"]`);
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
  rowElement?.classList.toggle("inherited", Boolean(row.fisicaHerdada));
  rowElement?.querySelector(".confirm-inherited")?.remove();
  rowElement?.querySelector(".qty-input")?.classList.toggle("inherited-input", Boolean(row.fisicaHerdada));
}

function updateLiveBadges(conf) {
  const progress = getProgress(conf);
  const blockMessage = completionBlockMessage(progress);
  const subtitle = document.querySelector(".page-subtitle");
  if (subtitle) subtitle.textContent = `${formatReportDateTime(conf)} · ${formatIntegerDisplay(progress.changed)} mudancas no sistema desde o relatorio anterior.`;
  const eyebrow = document.querySelector(".eyebrow");
  if (eyebrow) eyebrow.textContent = conf.status;
  const finishButton = document.getElementById("finishConference");
  if (finishButton) {
    finishButton.textContent = "Concluir";
    finishButton.disabled = Boolean(blockMessage);
    finishButton.title = blockMessage;
  }
  const countedStat = document.querySelector('[data-stat="counted"]');
  const reviewStat = document.querySelector('[data-stat="review"]');
  const divergentStat = document.querySelector('[data-stat="divergent"]');
  const emptyStat = document.querySelector('[data-stat="empty"]');
  if (countedStat) countedStat.textContent = `${formatIntegerDisplay(progress.counted)}/${formatIntegerDisplay(progress.total)}`;
  if (reviewStat) reviewStat.textContent = formatIntegerDisplay(getReviewCount(conf));
  if (divergentStat) divergentStat.textContent = formatIntegerDisplay(progress.divergent);
  if (emptyStat) emptyStat.textContent = formatIntegerDisplay(getEmptyCount(conf));
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
    state.importMeta = null;
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
  state.importMeta = null;
  document.getElementById("fileName").value = file.name;
  setImportPreview("Lendo PDF...");
  const meta = parseFileMeta(file.name);
  document.getElementById("stockName").value = meta.stockName;
  document.getElementById("reportDate").value = meta.reportDate;

  try {
    const text = await readPdfText(file);
    const pdfMeta = parsePdfMeta(text, meta);
    state.importMeta = pdfMeta;
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
  const conference = createConference({
    stockName,
    reportDate,
    reportTime: state.importMeta?.reportTime || "",
    reportDateTime: state.importMeta?.reportDateTime || buildReportDateTime(reportDate, state.importMeta?.reportTime || ""),
    fileName,
    rows,
  }, previous);
  state.data.conferences.unshift(conference);
  saveData();
  state.importRows = [];
  state.importMeta = null;
  showToast(previous ? "Relatorio mesclado e comparado ao anterior." : "Primeira conferencia criada.");
  navigateToConference(conference.id, getPriorityFilter(conference));
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
