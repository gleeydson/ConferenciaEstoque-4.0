import { createBackupPayload, downloadJson, loadData, saveStoredData } from "./state/storage.js";
import { getDiff, getProgress, getRowStatus, normalizeRow, numberOrZero } from "./domain/conference.js";
import { formatImportedRow, parseFileMeta, parsePdfMeta, parseRows, readPdfText } from "./import/pdfParser.js";

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
  query: "",
  activeConferenceId: null,
  activeProductHistory: null,
  importing: false,
  toast: "",
  data: loadData(),
};

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
  state.page = page;
  state.filter = "todos";
  state.query = "";
  render();
}

function setActiveConference(id) {
  state.activeConferenceId = id;
  state.page = "conference";
  state.filter = "todos";
  state.query = "";
  state.activeProductHistory = null;
  render();
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

function pageHeader(eyebrow, title, subtitle, actions = "") {
  return `
    <header class="topbar">
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
      ${recent.length ? recent.map(historyRow).join("") : emptyState("Nenhuma conferencia", "Importe o primeiro relatorio PDF para iniciar a trilha.")}
    </section>
  `;
}

function stat(label, value, key = "") {
  return `<article class="stat"><span>${label}</span><strong class="mono" ${key ? `data-stat="${key}"` : ""}>${formatIntegerDisplay(value)}</strong></article>`;
}

function renderImport() {
  return `
    ${pageHeader("Importacao", "Novo relatorio", "Envie um PDF. O sistema tenta extrair data e estoque pelo nome do arquivo e importa apenas ID, PRODUTO, RESERVADOS e QUANTIDADE.", "")}
    <section class="panel">
      <div class="panel-body">
        <label class="upload-zone" id="dropZone">
          <input id="pdfInput" type="file" accept="application/pdf,.pdf" />
          <div>
            <div class="upload-symbol">PDF</div>
            <h2>Solte o PDF aqui</h2>
            <p>Ou clique para selecionar. Exemplo de nome: <strong>05-07-2026 - 2.12 Estoque Material.pdf</strong></p>
          </div>
        </label>
        <form id="manualForm" class="form-grid" aria-label="Dados do relatorio">
          <div class="field">
            <label for="stockName">Nome do estoque</label>
            <input id="stockName" placeholder="2.12 Estoque Material" required />
          </div>
          <div class="field">
            <label for="reportDate">Data do relatorio</label>
            <input id="reportDate" type="date" required />
          </div>
          <div class="field">
            <label for="fileName">Arquivo</label>
            <input id="fileName" placeholder="Aguardando PDF" readonly />
          </div>
        </form>
        <div class="field" style="margin-top: 14px;">
          <label for="pasteRows">Fallback de importacao</label>
          <textarea id="pasteRows" placeholder="Cole linhas do relatorio se o PDF nao tiver texto selecionavel. Formato: ID | PRODUTO | RESERVADOS | QUANTIDADE | BOBINAS"></textarea>
          <div class="helper">PDFs escaneados dependem de OCR externo. Para relatorios textuais, a extracao acontece no navegador com PDF.js.</div>
        </div>
        <div id="importPreview" class="import-preview" hidden></div>
        <div class="actions" style="margin-top: 16px;">
          <button class="ghost-btn" id="demoImport" type="button">Usar exemplo</button>
          <button class="primary-btn" id="finishImport" type="button">Criar conferencia</button>
        </div>
      </div>
    </section>
  `;
}

function renderHistory() {
  const conferences = [...state.data.conferences].sort((a, b) => new Date(b.reportDate) - new Date(a.reportDate));
  return `
    ${pageHeader("Historico", "Conferencias", "Consulte cada ciclo por data, status, estoque, itens e resumo de divergencias.", `<button class="primary-btn" data-page="import" type="button">Novo PDF</button>`)}
    <section class="panel">
      ${conferences.length ? conferences.map(historyRow).join("") : emptyState("Historico vazio", "As conferencias importadas aparecerao aqui.")}
    </section>
  `;
}

function historyRow(conf) {
  const progress = getProgress(conf);
  return `
    <article class="history-row">
      <div>
        <h3>${escapeHtml(conf.stockName)}</h3>
        <p>${formatDate(conf.reportDate)} · ${escapeHtml(conf.fileName || "relatorio")}</p>
      </div>
      <div>
        <span class="badge ${conf.status === "Concluida" ? "green" : "gray"}">${conf.status}</span>
        <span class="badge ${progress.divergent ? "red" : "green"}">${formatIntegerDisplay(progress.divergent)} divergencias</span>
        <span class="badge ${progress.changed ? "blue" : "gray"}">${formatIntegerDisplay(progress.changed)} alterados</span>
      </div>
      <button class="ghost-btn" data-open="${conf.id}" type="button">${formatIntegerDisplay(progress.counted)}/${formatIntegerDisplay(progress.total)} itens</button>
    </article>
  `;
}

function renderStocks() {
  const groups = state.data.conferences.reduce((acc, item) => {
    acc[item.stockName] ||= [];
    acc[item.stockName].push(item);
    return acc;
  }, {});
  const rows = Object.entries(groups).map(([stock, conferences]) => {
    const ordered = conferences.sort((a, b) => new Date(a.reportDate) - new Date(b.reportDate));
    const totalChanged = ordered.reduce((sum, item) => sum + getProgress(item).changed, 0);
    const latest = ordered.at(-1);
    return `
      <article class="history-row">
        <div>
          <h3>${escapeHtml(stock)}</h3>
          <p>${formatIntegerDisplay(ordered.length)} conferencias · ultima em ${formatDate(latest.reportDate)}</p>
        </div>
        <div>
          <span class="badge blue">${formatIntegerDisplay(totalChanged)} alteracoes rastreadas</span>
          <span class="badge ${latest.status === "Pendente" ? "gray" : "green"}">${latest.status}</span>
        </div>
        <button class="ghost-btn" data-open="${latest.id}" type="button">Abrir ultima</button>
      </article>
    `;
  }).join("");

  return `
    ${pageHeader("Analise por estoque", "Evolucao diaria", "Veja a trilha de mudancas e investigue produtos que se movimentaram sem contagem fisica correspondente.", "")}
    <section class="panel">${rows || emptyState("Sem estoques", "Importe relatorios para formar a evolucao por estoque.")}</section>
  `;
}

function renderConference(conf) {
  if (!conf) return renderDashboard();
  const progress = getProgress(conf);
  const rows = filteredRows(conf);
  const actions = `
    <button class="ghost-btn" data-page="import" type="button">Atualizar com PDF</button>
    <button class="primary-btn" id="finishConference" type="button">${progress.pending ? "Marcar pendente" : "Concluir"}</button>
  `;

  return `
    ${pageHeader(conf.status, escapeHtml(conf.stockName), `${formatDate(conf.reportDate)} · ${formatIntegerDisplay(progress.counted)}/${formatIntegerDisplay(progress.total)} itens contados · ${formatIntegerDisplay(progress.changed)} itens mudaram desde o relatorio anterior.`, actions)}
    <div class="progress-dock" data-progress-dock>${formatIntegerDisplay(progress.counted)} de ${formatIntegerDisplay(progress.total)} contados</div>
    <section class="stats-grid grid compact-stats">
      ${stat("Itens", progress.total, "total")}
      ${stat("Pendentes", progress.pending, "pending")}
      ${stat("Divergentes", progress.divergent, "divergent")}
    </section>
    <section class="panel">
      <div class="table-tools">
        <input class="search" id="searchInput" value="${escapeHtml(state.query)}" placeholder="Buscar por ID ou produto" />
        <div class="segmented" role="tablist">
          ${filterButton("todos", "Todos")}
          ${filterButton("divergentes", "Divergentes")}
          ${filterButton("alterados", "Alterados")}
          ${filterButton("pendentes", "Pendentes")}
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Produto</th>
              <th>Reservados</th>
              <th>Quantidade</th>
              <th>Qtd fisica</th>
              <th>Diferenca</th>
              <th>Status</th>
              <th>Alteracao relatorio</th>
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
  const query = state.query.trim().toLowerCase();
  return conf.rows.filter((row) => {
    const diff = getDiff(row);
    const matchQuery = !query || row.id.toLowerCase().includes(query) || row.produto.toLowerCase().includes(query);
    const matchFilter =
      state.filter === "todos" ||
      (state.filter === "divergentes" && diff !== null && diff !== 0) ||
      (state.filter === "alterados" && row.movement !== "same") ||
      (state.filter === "pendentes" && diff === null);
    return matchQuery && matchFilter;
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
      <td><input class="table-input qty-input" inputmode="numeric" data-edit="${conf.id}:${row.id}:fisica" value="${escapeHtml(row.fisica)}" /></td>
      <td class="delta ${diff > 0 ? "amber" : diff < 0 ? "red" : diff === 0 ? "green" : ""}" data-diff="${conf.id}:${escapeHtml(row.id)}">${diff === null ? "-" : signed(diff)}</td>
      <td data-status="${conf.id}:${escapeHtml(row.id)}"><span class="badge ${status.color}">${status.label}</span></td>
      <td><span class="badge movement ${movementColor}">${movementLabel}</span></td>
      <td>
        <div class="action-cell">
          <span class="badge ${actionColor}">${actionLabel}</span>
          <button class="link-btn" data-history="${conf.id}:${escapeHtml(row.id)}" type="button">Historico</button>
        </div>
      </td>
      <td><input class="table-input" data-edit="${conf.id}:${row.id}:observacao" value="${escapeHtml(row.observacao)}" placeholder="Opcional" /></td>
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

function emptyState(title, text) {
  return `<div class="empty"><strong>${title}</strong>${text}</div>`;
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

  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      state.query = event.target.value;
      render();
    });
    searchInput.focus();
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
  }

  const finishConference = document.getElementById("finishConference");
  if (finishConference) {
    finishConference.addEventListener("click", () => {
      const conf = activeConference();
      conf.status = getProgress(conf).pending === 0 ? "Concluida" : "Pendente";
      saveData();
      showToast(conf.status === "Concluida" ? "Conferencia concluida." : "Conferencia salva como pendente.");
      render();
    });
  }

  bindBackupEvents();
  bindImportEvents();
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
  if (subtitle) subtitle.textContent = `${formatDate(conf.reportDate)} · ${formatIntegerDisplay(progress.counted)}/${formatIntegerDisplay(progress.total)} itens contados · ${formatIntegerDisplay(progress.changed)} itens mudaram desde o relatorio anterior.`;
  const progressDock = document.querySelector("[data-progress-dock]");
  if (progressDock) progressDock.textContent = `${formatIntegerDisplay(progress.counted)} de ${formatIntegerDisplay(progress.total)} contados`;
  const eyebrow = document.querySelector(".eyebrow");
  if (eyebrow) eyebrow.textContent = conf.status;
  const finishButton = document.getElementById("finishConference");
  if (finishButton) finishButton.textContent = progress.pending ? "Marcar pendente" : "Concluir";
  const totalStat = document.querySelector('[data-stat="total"]');
  const pendingStat = document.querySelector('[data-stat="pending"]');
  const divergentStat = document.querySelector('[data-stat="divergent"]');
  if (totalStat) totalStat.textContent = formatIntegerDisplay(progress.total);
  if (pendingStat) pendingStat.textContent = formatIntegerDisplay(progress.pending);
  if (divergentStat) divergentStat.textContent = formatIntegerDisplay(progress.divergent);
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
    document.getElementById("pasteRows").value = seedRows.map((row, index) => {
      const quantity = row.quantidade + [1, 0, -5, 0, 3, 0, 0, -2][index];
      return `${row.id} | ${row.produto} | ${row.reservados} | ${quantity}`;
    }).join("\n") + "\n1009 | Banco bistro preto | 0 | 24";
    showToast("Exemplo carregado.");
  });

  finishImport?.addEventListener("click", finishImportFlow);
}

async function handleFile(file) {
  if (!file) return;
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
      document.getElementById("pasteRows").value = rows.map(formatImportedRow).join("\n");
      setImportPreview(`Previa: ${rows.slice(0, 5).map(formatImportedRow).join("\n")}`);
      showToast(`${rows.length} itens extraidos do PDF.`);
    } else {
      setImportPreview(`Nenhum item reconhecido. Amostra lida:\n${text.split("\n").slice(0, 12).join("\n")}`);
      showToast("PDF lido, mas a tabela nao foi identificada. Cole as linhas no fallback.");
    }
  } catch (error) {
    setImportPreview(`Falha na leitura automatica: ${error.message || "erro desconhecido"}`);
    showToast("Nao foi possivel ler o PDF automaticamente. Cole as linhas no fallback.");
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
  const rows = parseRows(document.getElementById("pasteRows").value);
  if (!stockName || !reportDate || !rows.length) {
    showToast("Informe estoque, data e ao menos uma linha valida.");
    return;
  }

  const previous = latestByStock(stockName);
  const conference = createConference({ stockName, reportDate, fileName, rows }, previous);
  state.data.conferences.unshift(conference);
  state.activeConferenceId = conference.id;
  state.page = "conference";
  saveData();
  showToast(previous ? "Relatorio mesclado e comparado ao anterior." : "Primeira conferencia criada.");
  render();
}

function renderToast() {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = state.toast;
  toast.classList.toggle("show", Boolean(state.toast));
}

render();
