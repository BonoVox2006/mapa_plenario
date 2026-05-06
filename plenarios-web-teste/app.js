const STORAGE_KEY = "plenario_map_v2";
const DEPUTIES_KEY = "plenario_deputies_v1";
const DEPUTIES_META_KEY = "plenario_deputies_meta_v1";
const COMMISSION_UI_PREF_KEY = "plenario_commission_ui_pref_v1";
const PANEL_COLLAPSED_KEY = "plenario_panel_collapsed_v1";
const SHARED_SYNC_ENABLED = location.protocol !== "file:";
const IS_LINUX_CLIENT = /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent);

// Layouts fixos dos plenários (independentes de data-layout.js para evitar problemas de carregamento)
/** @type {import("./app").Layout[]} */ // apenas para editores; ignorado no navegador
function makeLayout(id, name, rows, cols) {
  const seats = [];
  const rowLabels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let r = 1; r <= rows; r++) {
    const prefix = rowLabels[r - 1];
    for (let c = 1; c <= cols; c++) {
      const seatId = `${prefix}${c}`;
      seats.push({ id: seatId, row: r, col: c, label: seatId });
    }
  }
  return { id, name, columns: cols, seats };
}

const FIXED_PLENARIO_LAYOUTS = [
  makeLayout("1", "Plenário 1", 4, 12),
  makeLayout("2", "Plenário 2", 4, 12),
  makeLayout("3", "Plenário 3", 4, 10),
  makeLayout("4", "Plenário 4", 4, 10),
  makeLayout("5", "Plenário 5", 4, 10),
  makeLayout("6", "Plenário 6", 4, 10),
  makeLayout("7", "Plenário 7", 4, 10),
  makeLayout("8", "Plenário 8", 4, 10),
  makeLayout("9", "Plenário 9", 4, 10),
  makeLayout("10", "Plenário 10", 4, 10),
  makeLayout("11", "Plenário 11", 4, 10),
  makeLayout("12", "Plenário 12", 4, 10),
  makeLayout("13", "Plenário 13", 4, 10),
  makeLayout("14", "Plenário 14", 4, 10),
  makeLayout("15", "Plenário 15", 5, 5),
  makeLayout("16", "Plenário 16", 5, 5)
];

/** @typedef {{id:string, nome:string, partido?:string, uf?:string, foto?:string, email?:string, isLider?:boolean, isViceLider?:boolean}} Deputy */
/** @typedef {{id:string, row:number, col:number, label:string}} Seat */
/** @typedef {{id:string, name:string, columns:number, seats:Seat[]}} Layout */

const $ = (sel) => document.querySelector(sel);

function safeText(s) {
  return (s ?? "").toString();
}

function normalize(s) {
  return safeText(s).trim().toLowerCase();
}

function normalizeFold(s) {
  return normalize(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeNameKey(s) {
  return normalizeFold(s).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function inferAllocatedWordByName(fullName) {
  const firstName = safeText(fullName).trim().split(/\s+/)[0] || "";
  const n = normalize(firstName);
  if (!n) return "alocado(a)";

  // Heurística simples para PT-BR:
  // - nomes terminados em "a" tendem ao feminino;
  // - alguns finais comuns masculinos evitam falso positivo.
  const likelyMaleEndingA = [
    "ca",
    "ga",
    "ia",
    "ta",
    "ua"
  ];

  if (n.endsWith("a")) {
    const hasMalePattern = likelyMaleEndingA.some((suf) => n.endsWith(suf));
    return hasMalePattern ? "alocado" : "alocada";
  }

  return "alocado";
}

function inferSeatedWordByName(fullName) {
  const allocatedWord = inferAllocatedWordByName(fullName);
  return allocatedWord === "alocada" ? "sentada" : "sentado";
}

function deputyMeta(dep) {
  const parts = [];
  if (dep.partido) parts.push(dep.partido);
  if (dep.uf) parts.push(dep.uf);
  return parts.join(" • ");
}

function extractNumericDeputyId(depId) {
  const m = String(depId || "").match(/(\d+)$/);
  return m ? m[1] : null;
}

function extractNumericFromAny(value) {
  const m = String(value || "").match(/(\d+)(?!.*\d)/);
  return m ? m[1] : null;
}

function classifyCommissionType(orgao) {
  const text = normalizeFold(
    `${orgao?.tipoOrgao || ""} ${orgao?.descricaoTipo || ""} ${orgao?.nome || ""} ${orgao?.apelido || ""} ${orgao?.sigla || ""} ${orgao?.nomePublicacao || ""}`
  );
  const sigla = normalizeFold(orgao?.sigla || "");

  // Excluir subcomissões e comissões mistas
  if (text.includes("subcomissao") || sigla.startsWith("sub")) return null;
  if (text.includes("comissao mista")) return null;

  // Excluir explicitamente comissoes de Medida Provisoria
  if (text.includes("medida provisoria") || sigla.startsWith("mpv")) return null;

  // Permanentes: somente "Comissão Permanente" (sem subcomissão/mista)
  if (text.includes("comissao permanente")) return "permanente";

  // Temporarias desejadas: Especiais, Externas, CPI e Grupo de Trabalho.
  if (text.includes("comissao especial")) return "temporaria";
  if (text.includes("comissao externa")) return "temporaria";
  if (text.includes("cpi") || text.includes("comissao parlamentar de inquerito")) return "temporaria";
  if (text.includes("grupo de trabalho") || sigla.startsWith("gt")) return "temporaria";

  return null;
}

function isCommissionActive(orgao) {
  const statusText = normalizeFold(
    `${orgao?.situacao || ""} ${orgao?.status || ""} ${orgao?.nome || ""} ${orgao?.apelido || ""} ${orgao?.nomePublicacao || ""}`
  );
  if (
    statusText.includes("arquivad") ||
    statusText.includes("encerrad") ||
    statusText.includes("extinta") ||
    statusText.includes("finalizad")
  ) {
    return false;
  }

  const fim = orgao?.dataFim || orgao?.dataFimRel || null;
  if (!fim) return true;
  const d = new Date(fim);
  if (Number.isNaN(d.getTime())) return true;
  return d >= new Date();
}

function sanitizePdfLines(text) {
  return safeText(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^--\s*\d+\s*of\s*\d+\s*--$/i.test(l))
    .filter((l) => !/^CÂMARA DOS DEPUTADOS$/i.test(l))
    .filter((l) => !/^DEPUTADOS$/i.test(l))
    .filter((l) => !/^FEDERAIS$/i.test(l))
    .filter((l) => !/^\d{4}\s*-\s*\d{4}$/.test(l))
    .filter((l) => !/^\d+$/.test(l));
}

function parseDeputiesFromPdfText(text) {
  const lines = sanitizePdfLines(text);
  const partyUfRe = /^(.+?)\s*-\s*([A-Z]{2})$/;
  const emailRe = /([A-Z0-9._%+-]+@camara\.leg\.br)/i;

  /** @type {Deputy[]} */
  const out = [];
  let nameParts = [];
  /** @type {(Deputy & {email?:string})|null} */
  let pending = null;

  const finalize = () => {
    if (!pending) return;
    if (!pending.nome || !pending.partido || !pending.uf) {
      pending = null;
      return;
    }
    const base =
      pending.email?.split("@")[0] ||
      `${normalize(pending.nome).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${pending.uf.toLowerCase()}`;
    pending.id = `dep-${base}`;
    out.push(pending);
    pending = null;
  };

  for (const l of lines) {
    if (/^(Gab\.|Fone|Fax)\b/i.test(l)) continue;

    const m = l.match(partyUfRe);
    if (m) {
      const nome = nameParts.join(" ").replace(/\s+/g, " ").trim();
      pending = { id: "", nome, partido: m[1].trim(), uf: m[2].trim() };
      nameParts = [];
      continue;
    }

    const em = l.match(emailRe);
    if (em && pending && !pending.email) {
      pending.email = em[1];
      finalize();
      continue;
    }

    // If a record is pending but email got lost in extraction, treat next name-like line as start of next record.
    if (pending) {
      if (l && !partyUfRe.test(l) && !emailRe.test(l) && /^[A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ]/.test(l) && l.length >= 3 && !/dep\.$/i.test(l)) {
        finalize();
        nameParts = [l];
      }
      continue;
    }

    // building a name (may span multiple lines)
    if (/DEPUTADOS/i.test(l)) continue;
    if (/FEDERAIS/i.test(l)) continue;
    if (/2023\s*-\s*2027/.test(l)) continue;
    nameParts.push(l);
  }

  finalize();

  // de-dup by id
  const seen = new Set();
  return out.filter((d) => {
    if (!d.id) return false;
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
}

async function enrichDeputiesWithLeadership(list) {
  if (!Array.isArray(list)) return list;
  if (location.hostname !== "localhost") return list;

  try {
    const res = await fetch("/api/deputados", { headers: { Accept: "application/json" } });
    if (!res.ok) return list;
    const data = await res.json();
    const arr = data?.dados;
    if (!Array.isArray(arr) || arr.length === 0) return list;

    /** @type {Map<string, {isLider:boolean, isViceLider:boolean}>} */
    const map = new Map();
    for (const d of arr) {
      if (!d?.email) continue;
      const key = String(d.email).toLowerCase();
      map.set(key, { isLider: !!d.isLider, isViceLider: !!d.isViceLider });
    }

    return list.map((dep) => {
      const email = dep?.email ? String(dep.email).toLowerCase() : null;
      if (!email) return dep;
      const m = map.get(email);
      if (!m) return dep;
      return { ...dep, isLider: m.isLider, isViceLider: m.isViceLider };
    });
  } catch {
    return list;
  }
}

function loadDeputiesFromStorage() {
  try {
    const raw = localStorage.getItem(DEPUTIES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDeputiesToStorage(listOrNull) {
  if (!listOrNull) {
    localStorage.removeItem(DEPUTIES_KEY);
    localStorage.removeItem(DEPUTIES_META_KEY);
    return;
  }
  localStorage.setItem(DEPUTIES_KEY, JSON.stringify(listOrNull));
}

function saveDeputiesMeta(meta) {
  try {
    localStorage.setItem(DEPUTIES_META_KEY, JSON.stringify(meta));
  } catch {
    // ignore
  }
}

function loadDeputiesMeta() {
  try {
    const raw = localStorage.getItem(DEPUTIES_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function loadCommissionUiPref() {
  try {
    const raw = localStorage.getItem(COMMISSION_UI_PREF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      type: parsed.type ? String(parsed.type) : null,
      commissionId: parsed.commissionId ? String(parsed.commissionId) : null
    };
  } catch {
    return null;
  }
}

function saveCommissionUiPref(type, commissionId) {
  const payload = {
    type: type ? String(type) : null,
    commissionId: commissionId ? String(commissionId) : null
  };
  localStorage.setItem(COMMISSION_UI_PREF_KEY, JSON.stringify(payload));
}

function mapDeputadoFromApiRow(d) {
  /** @type {Deputy} */
  return {
    id: `camara-${d.id}`,
    nome: String(d.nome),
    partido: d.siglaPartido ? String(d.siglaPartido) : undefined,
    uf: d.siglaUf ? String(d.siglaUf) : undefined,
    foto: d.urlFoto ? String(d.urlFoto) : undefined,
    email: d.email ? String(d.email) : undefined,
    isLider: !!d.isLider,
    isViceLider: !!d.isViceLider
  };
}

async function fetchDeputadosDadosAbertosDireto() {
  const base = "https://dadosabertos.camara.leg.br/api/v2/deputados";
  const perPage = 100;
  let page = 1;
  /** @type {Deputy[]} */
  const out = [];

  for (;;) {
    const url = `${base}?itens=${perPage}&pagina=${page}&ordem=ASC&ordenarPor=nome`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Falha ao buscar lista no site da Câmara.");
    const data = await res.json();
    const arr = data?.dados;
    if (!Array.isArray(arr) || arr.length === 0) break;

    for (const d of arr) {
      if (!d?.id || !d?.nome) continue;
      out.push(mapDeputadoFromApiRow(d));
    }

    if (arr.length < perPage) break;
    page += 1;
    if (page > 50) break;
  }

  return out;
}

async function fetchDeputadosViaProxyLocal() {
  const res = await fetch("/api/deputados", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Falha ao buscar lista no servidor local.");
  const data = await res.json();
  const arr = data?.dados;
  if (!Array.isArray(arr) || arr.length === 0) return [];
  /** @type {Deputy[]} */
  const out = [];
  for (const d of arr) {
    if (!d?.id || !d?.nome) continue;
    out.push(mapDeputadoFromApiRow(d));
  }
  return out;
}

async function fetchAllDeputiesFromCamara() {
  // 1) Primeiro: Dados Abertos direto no navegador (fonte oficial).
  // 2) Se falhar (CORS, rede, etc.) ou vier vazio: proxy local `/api/deputados`.

  try {
    const direct = await fetchDeputadosDadosAbertosDireto();
    if (direct.length > 0) return direct;
  } catch {
    // fallback abaixo
  }

  try {
    const proxied = await fetchDeputadosViaProxyLocal();
    if (proxied.length > 0) return proxied;
  } catch {
    // último erro
  }

  throw new Error("Não foi possível obter a lista de deputados (Dados Abertos nem servidor local).");
}

function makeAvatar(url, alt) {
  const wrap = document.createElement("div");
  wrap.className = "avatar";
  const img = document.createElement("img");
  img.alt = alt || "";
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.src =
    url ||
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%23172544'/%3E%3Cpath d='M60 64c13 0 24-11 24-24S73 16 60 16 36 27 36 40s11 24 24 24Zm0 8c-20 0-36 11-36 25v7h72v-7c0-14-16-25-36-25Z' fill='%23ffffff' fill-opacity='.5'/%3E%3C/svg%3E";
  wrap.appendChild(img);
  return wrap;
}

function seatFingerprint(seat) {
  return `${seat.id}::${seat.row}::${seat.col}`;
}

function getPresidentSeatsForLayout(layoutId) {
  const isSmall = layoutId === "15" || layoutId === "16";
  if (isSmall) {
    return [
      { id: "MESA-1", row: 0, col: 1, label: "Mesa 1" },
      { id: "MESA-PRES", row: 0, col: 2, label: "Mesa (Presidente)" },
      { id: "MESA-2", row: 0, col: 3, label: "Mesa 2" }
    ];
  }
  return [
    { id: "MESA-1", row: 0, col: 1, label: "Mesa 1" },
    { id: "MESA-2", row: 0, col: 2, label: "Mesa 2" },
    { id: "MESA-PRES", row: 0, col: 3, label: "Mesa (Presidente)" },
    { id: "MESA-3", row: 0, col: 4, label: "Mesa 3" },
    { id: "MESA-4", row: 0, col: 5, label: "Mesa 4" }
  ];
}

function createEmptyState(layout) {
  /** @type {Record<string, string|null>} */
  const allocations = {};
  for (const s of layout.seats) allocations[seatFingerprint(s)] = null;
  for (const s of getPresidentSeatsForLayout(layout.id)) allocations[seatFingerprint(s)] = null;
  return { layoutId: layout.id, layoutName: layout.name, allocations };
}

function loadState(layout) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyState(layout);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return createEmptyState(layout);
    const byLayout = parsed.layouts;
    if (!byLayout || typeof byLayout !== "object") return createEmptyState(layout);
    const current = byLayout[layout.id];
    if (!current || typeof current !== "object" || typeof current.allocations !== "object") {
      return createEmptyState(layout);
    }
    const empty = createEmptyState(layout);
    for (const [k, v] of Object.entries(current.allocations)) {
      if (k in empty.allocations) empty.allocations[k] = v ?? null;
    }
    return empty;
  } catch {
    return createEmptyState(layout);
  }
}

function saveStateLocal(state) {
  let parsed = {};
  try {
    parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    parsed = {};
  }
  const layouts = parsed.layouts && typeof parsed.layouts === "object" ? parsed.layouts : {};
  layouts[state.layoutId] = state;
  parsed.layouts = layouts;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
}

function saveState(state) {
  saveStateLocal(state);
  if (SHARED_SYNC_ENABLED) {
    void pushSharedState(state).catch(() => {});
  }
}

function stateFromServer(layout, remoteAllocations) {
  const empty = createEmptyState(layout);
  if (!remoteAllocations || typeof remoteAllocations !== "object") return empty;
  for (const [k, v] of Object.entries(remoteAllocations)) {
    if (k in empty.allocations) empty.allocations[k] = v ?? null;
  }
  return empty;
}

async function fetchSharedState(layoutId) {
  const url = `/api/state?layoutId=${encodeURIComponent(layoutId)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Falha ao ler estado compartilhado.");
  const data = await res.json();
  return data?.dados || null;
}

async function pushSharedState(state) {
  const payload = {
    layoutId: state.layoutId,
    allocations: state.allocations
  };
  const res = await fetch("/api/state", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Falha ao gravar estado compartilhado.");
  return res.json();
}

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Falha ao carregar ${url}`);
  return await res.json();
}

function renderSelectedDeputy(dep) {
  const host = $("#selectedDeputy");
  host.innerHTML = "";
  if (!dep) {
    host.innerHTML = `<div class="inspector__empty">Nenhum deputado selecionado.</div>`;
    return;
  }
  const box = document.createElement("div");
  box.className = "selectedBox";
  box.appendChild(makeAvatar(dep.foto, dep.nome));
  const main = document.createElement("div");
  const name = document.createElement("div");
  name.className = "liName";
  name.textContent = dep.nome;
  const meta = document.createElement("div");
  meta.className = "liMeta";
  meta.textContent = deputyMeta(dep);
  main.appendChild(name);
  main.appendChild(meta);
  box.appendChild(main);
  host.appendChild(box);
}

function renderDeputyListInto(list, deps, activeId, onPick, getMemberHint) {
  list.innerHTML = "";
  for (const dep of deps) {
    const item = document.createElement("div");
    item.className = `listItem${dep.id === activeId ? " listItem--active" : ""}`;
    item.role = "option";
    item.tabIndex = 0;
    item.addEventListener("click", () => onPick(dep));
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onPick(dep);
      }
    });

    item.appendChild(makeAvatar(dep.foto, dep.nome));
    const main = document.createElement("div");
    main.className = "liMain";

    const name = document.createElement("div");
    name.className = "liName";
    name.textContent = dep.nome;

    const meta = document.createElement("div");
    meta.className = "liMeta";
    const hint = getMemberHint ? getMemberHint(dep) : "";
    meta.textContent = hint ? `${deputyMeta(dep)}${deputyMeta(dep) ? " • " : ""}${hint}` : deputyMeta(dep);

    main.appendChild(name);
    main.appendChild(meta);
    item.appendChild(main);
    list.appendChild(item);
  }
}

function renderDeputyList(deps, activeId, onPick) {
  const list = $("#deputyList");
  renderDeputyListInto(list, deps, activeId, onPick, null);
}

function renderSeatInspector({ seat, dep, onRemove }) {
  const host = $("#seatInspector");
  host.innerHTML = "";

  const row = document.createElement("div");
  row.className = "inspectorRow";
  const left = document.createElement("div");
  left.appendChild(makeAvatar(dep?.foto, dep?.nome || "Vazio"));

  const right = document.createElement("div");
  const title = document.createElement("div");
  title.className = "inspectorTitle";
  title.textContent = seat.label;
  const meta = document.createElement("div");
  meta.className = "inspectorMeta";
  meta.textContent = dep ? `${dep.nome}${deputyMeta(dep) ? ` — ${deputyMeta(dep)}` : ""}` : "Cadeira vazia";
  right.appendChild(title);
  right.appendChild(meta);

  row.appendChild(left);
  row.appendChild(right);
  host.appendChild(row);

  const actions = document.createElement("div");
  actions.className = "inspectorActions";
  const removeBtn = document.createElement("button");
  removeBtn.className = "btn btn--ghost";
  removeBtn.type = "button";
  removeBtn.textContent = "Remover desta cadeira";
  removeBtn.disabled = !dep;
  removeBtn.addEventListener("click", onRemove);
  actions.appendChild(removeBtn);
  host.appendChild(actions);
}

/** Papéis na lista oficial (snapshot); `representante` conta como “líder” para o selo L. */
function snapshotLeadershipRoles(liderancasByCamara, depId) {
  if (!(liderancasByCamara instanceof Map) || liderancasByCamara.size === 0) {
    return { isLiderSnapshot: false, isViceSnapshot: false };
  }
  const num = extractNumericDeputyId(depId);
  if (!num) return { isLiderSnapshot: false, isViceSnapshot: false };
  const rows = liderancasByCamara.get(num) || [];
  let isLiderSnapshot = false;
  let isViceSnapshot = false;
  for (const row of rows) {
    const rt = row.role_type;
    if (rt === "lider" || rt === "representante") isLiderSnapshot = true;
    if (rt === "vice_lider") isViceSnapshot = true;
  }
  return { isLiderSnapshot, isViceSnapshot };
}

function appendSeatLeadershipBadges(seatEl, depId, liderancasByCamara) {
  const { isLiderSnapshot, isViceSnapshot } = snapshotLeadershipRoles(liderancasByCamara, depId);
  if (!isLiderSnapshot && !isViceSnapshot) return;
  const wrap = document.createElement("div");
  wrap.className = "seatLeadershipBadges";
  wrap.setAttribute("aria-hidden", "true");
  if (isLiderSnapshot) {
    const b = document.createElement("span");
    b.className = "seatLeadershipBadge seatLeadershipBadge--l";
    b.textContent = "L";
    b.title = "Líder (lista oficial da Câmara)";
    wrap.appendChild(b);
  }
  if (isViceSnapshot) {
    const b = document.createElement("span");
    b.className = "seatLeadershipBadge seatLeadershipBadge--vl";
    b.textContent = "VL";
    b.title = "Vice-líder (lista oficial da Câmara)";
    wrap.appendChild(b);
  }
  seatEl.appendChild(wrap);
}

function renderGrid(
  layout,
  deputiesById,
  state,
  activeSeatKey,
  onSeatClick,
  memberDeputyIds,
  liderancasByCamara
) {
  const grid = $("#seatGrid");
  grid.style.gridTemplateColumns = `repeat(${layout.columns}, var(--cellW))`;
  grid.innerHTML = "";

  const byPos = new Map();
  for (const s of layout.seats) {
    byPos.set(`${s.row}:${s.col}`, s);
  }

  const maxRow = Math.max(...layout.seats.map((s) => s.row));
  for (let r = 1; r <= maxRow; r++) {
    for (let c = 1; c <= layout.columns; c++) {
      const seat = byPos.get(`${r}:${c}`);
      if (!seat) {
        const spacer = document.createElement("div");
        spacer.style.opacity = "0";
        spacer.style.pointerEvents = "none";
        grid.appendChild(spacer);
        continue;
      }

      const key = seatFingerprint(seat);
      const depId = state.allocations[key] || null;
      const dep = depId ? deputiesById.get(depId) : null;

      const el = document.createElement("div");
      let cls = `seat${dep ? "" : " seat--empty"}${activeSeatKey === key ? " seat--active" : ""}`;
      if (dep) {
        if (memberDeputyIds && memberDeputyIds.has(dep.id)) cls += " seat--membro";
        if (dep.isLider) cls += " seat--lider";
        else if (dep.isViceLider) cls += " seat--vice";
      }
      el.className = cls;
      el.dataset.seatKey = key;
      el.addEventListener("click", () => onSeatClick(seat, key));

      const content = document.createElement("div");
      content.className = "seat__content";
      content.appendChild(makeAvatar(dep?.foto, dep?.nome || "Vazio"));
      const main = document.createElement("div");
      const name = document.createElement("div");
      name.className = "seat__name";
      name.textContent = dep ? dep.nome : "—";
      const meta = document.createElement("div");
      meta.className = "seat__meta";
      meta.textContent = dep ? deputyMeta(dep) : "Clique para alocar";
      main.appendChild(name);
      main.appendChild(meta);
      content.appendChild(main);

      el.appendChild(content);
      if (depId) appendSeatLeadershipBadges(el, depId, liderancasByCamara);
      grid.appendChild(el);
    }
  }
}

function countAllocated(state) {
  let n = 0;
  for (const v of Object.values(state.allocations)) if (v) n++;
  return n;
}

function renderPresidentArea(
  layout,
  deputiesById,
  state,
  activeSeatKey,
  onSeatClick,
  memberDeputyIds,
  liderancasByCamara
) {
  const host = $("#presidentArea");
  if (!host) return;

  const isSmall = layout.id === "15" || layout.id === "16";
  const mesaSeats = getPresidentSeatsForLayout(layout.id);

  // 1–2 e 3–14: dois boxes pequenos + Presidente + dois boxes pequenos
  // 15–16: um box pequeno + Presidente + um box pequeno
  const boxes =
    isSmall
      ? ["small", "large", "small"]
      : ["small", "small", "large", "small", "small"];

  const presidentCirclesCount = isSmall ? 3 : 5;

  host.innerHTML = "";

  const rect = document.createElement("div");
  rect.className = "presidentRect";
  if (isSmall) rect.classList.add("presidentRect--small");

  boxes.forEach((b, idx) => {
    const box = document.createElement("div");
    const seat = mesaSeats[idx];
    const key = seat ? seatFingerprint(seat) : null;
    const depId = key ? state.allocations[key] || null : null;
    const dep = depId ? deputiesById.get(depId) : null;

    let cls = `presidentBox seat${dep ? "" : " seat--empty"}${activeSeatKey === key ? " seat--active" : ""}`;
    if (dep) {
      if (memberDeputyIds && memberDeputyIds.has(dep.id)) cls += " seat--membro";
      if (dep.isLider) cls += " seat--lider";
      else if (dep.isViceLider) cls += " seat--vice";
    }
    box.className = cls;

    const content = document.createElement("div");
    content.className = "seat__content";
    content.appendChild(makeAvatar(dep?.foto, dep?.nome || "Vazio"));
    const main = document.createElement("div");
    const name = document.createElement("div");
    name.className = "seat__name";
    name.textContent = dep ? dep.nome : b === "large" ? "PRESIDENTE" : seat?.label || "Mesa";
    const meta = document.createElement("div");
    meta.className = "seat__meta";
    meta.textContent = dep ? deputyMeta(dep) : "Clique para alocar";
    main.appendChild(name);
    main.appendChild(meta);
    content.appendChild(main);
    box.appendChild(content);

    if (depId) appendSeatLeadershipBadges(box, depId, liderancasByCamara);

    if (seat && key) {
      box.addEventListener("click", () => onSeatClick(seat, key));
    }
    rect.appendChild(box);
  });

  const circles = document.createElement("div");
  circles.className = "presidentCircles";
  const legend = document.createElement("div");
  legend.className = "presidentLegend";
  legend.textContent = "PRESIDENTE";
  circles.appendChild(legend);

  host.appendChild(rect);
  host.appendChild(circles);
}

/**
 * Substitui a lista nativa do &lt;select&gt; (cinza no Windows) por painel no tema do app.
 * Mantém o &lt;select&gt; no DOM para .value, change e leitores de tela.
 */
function mountCustomSelect(selectEl) {
  if (!selectEl || selectEl.dataset.customSelectMounted) return;
  selectEl.dataset.customSelectMounted = "1";

  const wrap = document.createElement("div");
  wrap.className = "customSelect";
  const parent = selectEl.parentNode;
  parent.insertBefore(wrap, selectEl);
  wrap.appendChild(selectEl);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "customSelect__btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute(
    "aria-label",
    selectEl.id === "commissionType" ? "Tipo de comissão" : selectEl.id === "commissionSelect" ? "Comissão" : "Selecionar"
  );

  const panel = document.createElement("div");
  panel.className = "customSelect__panel";
  panel.setAttribute("role", "listbox");
  panel.hidden = true;

  wrap.insertBefore(btn, selectEl);
  wrap.appendChild(panel);

  selectEl.classList.add("customSelect__native");

  const closePanel = () => {
    panel.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };

  const buildPanelItems = () => {
    panel.innerHTML = "";
    const opts = Array.from(selectEl.options);
    for (let i = 0; i < opts.length; i++) {
      const opt = opts[i];
      const row = document.createElement("button");
      row.type = "button";
      row.className = "customSelect__option";
      if (opt.selected) row.classList.add("customSelect__option--active");
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", opt.selected ? "true" : "false");
      row.textContent = opt.textContent || opt.value || "—";
      row.dataset.value = opt.value;
      if (opt.disabled) {
        row.disabled = true;
        row.classList.add("customSelect__option--disabled");
      }
      row.addEventListener("click", () => {
        if (opt.disabled) return;
        selectEl.selectedIndex = i;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        syncButton();
        closePanel();
      });
      panel.appendChild(row);
    }
  };

  const syncButton = () => {
    const idx = selectEl.selectedIndex;
    const sel = idx >= 0 ? selectEl.options[idx] : null;
    btn.textContent = sel ? sel.textContent : "";
  };

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (panel.hidden) {
      buildPanelItems();
      panel.hidden = false;
      btn.setAttribute("aria-expanded", "true");
    } else {
      closePanel();
    }
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) closePanel();
  });

  wrap.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
  });

  selectEl.addEventListener("change", syncButton);
  syncButton();

  selectEl._customSelectSync = () => {
    syncButton();
    if (!panel.hidden) buildPanelItems();
  };
}

async function main() {
  /** @type {Layout[]} */
  const allLayouts = FIXED_PLENARIO_LAYOUTS;
  let currentLayout = allLayouts[0];
  /** @type {Deputy[]} */
  let deputies =
    loadDeputiesFromStorage() ||
    window.PLENARIO_DEPUTADOS ||
    (await loadJson("./deputados.json")); // fallback (requires server)

  // Se a lista vier do PDF/localStorage e não tiver liderança, enriquece automaticamente.
  if (location.hostname === "localhost") {
    const hasLeadershipFields = deputies.some(
      (d) => d && (typeof d.isLider === "boolean" || typeof d.isViceLider === "boolean")
    );
    if (!hasLeadershipFields) {
      deputies = await enrichDeputiesWithLeadership(deputies);
    }
  }

  const deputiesById = new Map(deputies.map((d) => [d.id, d]));
  const deputyIdByNumeric = new Map();
  const deputyIdByNameFold = new Map();
  /** @type {{id:string, key:string}[]} */
  const deputyNameIndex = [];
  for (const d of deputies) {
    const num = extractNumericDeputyId(d.id);
    if (num) deputyIdByNumeric.set(num, d.id);
    const key = normalizeNameKey(d.nome);
    deputyIdByNameFold.set(key, d.id);
    deputyNameIndex.push({ id: d.id, key });
  }

  let selectedDeputyId = null;
  let activeSeatKey = null;
  let activeSeat = null;
  const memberDeputyIds = new Set();
  const memberRoleByDeputyId = new Map();

  const tabsRoot = document.getElementById("layoutTabs");
  const currentPlenarioText = $("#currentPlenarioText");
  const layoutRoot = document.querySelector(".layout");
  const togglePanelBtn = $("#btnTogglePanel");
  let state = loadState(currentLayout);
  let currentLayoutVersion = -1;

  /** @type {Map<string, any[]>} */
  let liderancasByCamara = new Map();
  let liderancasApiMeta = null;
  let liderancasFetchError = null;

  function buildLiderancasIndex(rows) {
    const m = new Map();
    for (const row of rows || []) {
      const id = row?.deputado_id_camara != null ? String(row.deputado_id_camara) : "";
      if (!id) continue;
      if (!m.has(id)) m.set(id, []);
      m.get(id).push(row);
    }
    return m;
  }

  async function fetchLiderancasSnapshot() {
    if (!SHARED_SYNC_ENABLED) return;
    try {
      const res = await fetch("/api/liderancas", { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      liderancasByCamara = buildLiderancasIndex(data.dados || []);
      liderancasApiMeta = data.meta || null;
      liderancasFetchError = null;
    } catch (e) {
      liderancasFetchError = String(e?.message || e);
    }
  }

  const setPanelCollapsed = (collapsed) => {
    if (!layoutRoot || !togglePanelBtn) return;
    layoutRoot.classList.toggle("layout--panelHidden", !!collapsed);
    togglePanelBtn.textContent = collapsed ? "Mostrar menu" : "Ocultar menu";
    togglePanelBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    try {
      localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  };

  const loadPanelCollapsedPref = () => {
    try {
      return localStorage.getItem(PANEL_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  };

  if (togglePanelBtn && layoutRoot) {
    setPanelCollapsed(loadPanelCollapsedPref());
    togglePanelBtn.addEventListener("click", () => {
      const next = !layoutRoot.classList.contains("layout--panelHidden");
      setPanelCollapsed(next);
    });
  }

  const updateStatus = () => {
    const meta = loadDeputiesMeta();
    const metaText = meta?.source
      ? ` • lista: ${meta.source}${meta.updatedAt ? ` (${new Date(meta.updatedAt).toLocaleString()})` : ""}`
      : "";
    const totalSeats = currentLayout.seats.length + getPresidentSeatsForLayout(currentLayout.id).length;
    let liderText = "";
    if (SHARED_SYNC_ENABLED) {
      if (liderancasFetchError) {
        liderText = ` • lideranças: erro ao carregar (${liderancasFetchError})`;
      } else {
        const lastDb = liderancasApiMeta?.lastSuccessAt
          ? new Date(liderancasApiMeta.lastSuccessAt).toLocaleString("pt-BR")
          : "—";
        const n = Number(liderancasApiMeta?.lastItemCount || 0);
        liderText = ` • lideranças Câmara: ${n} reg. • última gravação no servidor ${lastDb} • este app atualiza a lista ~10 min • sync oficial seg–sex 8h–19h (Brasília), sem sáb/dom nem feriados nacionais`;
      }
    }
    $("#statusText").textContent = `${countAllocated(state)} alocados • ${totalSeats} cadeiras${metaText}${liderText}`;
  };

  const setSelectedDeputy = (dep) => {
    selectedDeputyId = dep?.id || null;
    renderSelectedDeputy(dep || null);
    rerenderDeputyList();
  };

  const getActiveSeatDeputy = () => {
    if (!activeSeat || !activeSeatKey) return null;
    const depId = state.allocations[activeSeatKey] || null;
    return depId ? deputiesById.get(depId) || null : null;
  };

  const refreshInspector = () => {
    if (!activeSeat || !activeSeatKey) {
      $("#seatInspector").innerHTML = `<div class="inspector__empty">Clique em uma cadeira para ver/editar.</div>`;
      return;
    }
    renderSeatInspector({
      seat: activeSeat,
      dep: getActiveSeatDeputy(),
      onRemove: () => {
        state.allocations[activeSeatKey] = null;
        saveState(state);
        rerenderGrid();
        refreshInspector();
        updateStatus();
      }
    });
  };

  function resetSeatDialogChrome() {
    const titleEl = $("#seatDialogTitle");
    const assignBtn = $("#btnAssignSelected");
    if (titleEl) titleEl.textContent = "Alocar deputado";
    if (assignBtn) assignBtn.style.removeProperty("display");
  }

  /** Clique simples: vazio + deputado selecionado → aloca direto; ocupado → só “Remover”. */
  function handleSeatClick(seat, key) {
    activeSeat = seat;
    activeSeatKey = key;

    const depId = state.allocations[key] || null;
    const occupied = !!depId;

    if (!occupied && selectedDeputyId) {
      state.allocations[key] = selectedDeputyId;
      saveState(state);
      rerenderGrid();
      refreshInspector();
      updateStatus();
      return;
    }

    rerenderGrid();
    refreshInspector();

    if (!occupied) {
      return;
    }

    const dep = depId ? deputiesById.get(depId) : null;
    const dialog = $("#seatDialog");
    const titleEl = $("#seatDialogTitle");
    const assignBtn = $("#btnAssignSelected");
    if (titleEl) titleEl.textContent = "Cadeira ocupada";
    $("#dialogSeatLabel").textContent = dep
      ? `Cadeira: ${seat.label} — ${dep.nome}`
      : `Cadeira: ${seat.label}`;
    if (assignBtn) assignBtn.style.display = "none";
    dialog.showModal();
  }

  const rerenderGrid = () => {
    renderGrid(
      currentLayout,
      deputiesById,
      state,
      activeSeatKey,
      handleSeatClick,
      memberDeputyIds,
      liderancasByCamara
    );
    renderPresidentArea(
      currentLayout,
      deputiesById,
      state,
      activeSeatKey,
      handleSeatClick,
      memberDeputyIds,
      liderancasByCamara
    );
    updateStatus();
  };

  const rerenderDeputyList = () => {
    const q = normalize($("#deputySearch").value);
    const filtered = deputies.filter((d) => {
      if (!q) return true;
      const hay = `${d.nome} ${d.partido || ""} ${d.uf || ""}`.toLowerCase();
      return hay.includes(q);
    });
    renderDeputyListInto(
      $("#deputyList"),
      filtered,
      selectedDeputyId,
      (dep) => setSelectedDeputy(dep),
      (dep) => {
        const role = memberRoleByDeputyId.get(dep.id);
        if (!role) return "Não membro";
        return `Membro (${role.label})`;
      }
    );
  };

  // Deputies import dialog
  const deputiesDialog = $("#deputiesDialog");
  const paste = $("#deputiesPaste");
  const preview = $("#deputiesPreview");
  const findDeputyDialog = $("#findDeputyDialog");
  const findDeputySearch = $("#findDeputySearch");
  const findDeputyList = $("#findDeputyList");
  const findDeputyResult = $("#findDeputyResult");
  const commissionTypeEl = $("#commissionType");
  const commissionSelectEl = $("#commissionSelect");
  mountCustomSelect(commissionTypeEl);
  mountCustomSelect(commissionSelectEl);
  let findDeputySelectedId = null;
  /** @type {{id:string,name:string,type:string}[]} */
  let allCommissions = [];

  const setCommissionOptions = (type, selectedId) => {
    if (!commissionSelectEl) return;
    const items = allCommissions.filter((c) => c.type === type);
    commissionSelectEl.innerHTML = "";
    if (!items.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Nenhuma comissão ativa encontrada";
      commissionSelectEl.appendChild(opt);
      commissionSelectEl._customSelectSync?.();
      return;
    }
    for (const c of items) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      if (selectedId && selectedId === c.id) opt.selected = true;
      commissionSelectEl.appendChild(opt);
    }
    commissionSelectEl._customSelectSync?.();
  };

  const clearMemberMarks = () => {
    memberDeputyIds.clear();
    memberRoleByDeputyId.clear();
    rerenderGrid();
    rerenderDeputyList();
  };

  const getMemberRoleFromRow = (m) => {
    const t = normalizeFold(`${m?.titulo || ""} ${m?.condicao || ""}`);
    if (!t) return { rank: 1, label: "Membro" };

    if (t.includes("presidente")) {
      if (t.includes("1") && t.includes("vice")) return { rank: 7, label: "1º Vice-Presidente" };
      if (t.includes("2") && t.includes("vice")) return { rank: 7, label: "2º Vice-Presidente" };
      if (t.includes("3") && t.includes("vice")) return { rank: 7, label: "3º Vice-Presidente" };
      if (t.includes("vice")) return { rank: 7, label: "Vice-Presidente" };
      return { rank: 8, label: "Presidente" };
    }
    if (t.includes("relator")) return { rank: 6, label: "Relator" };
    if (t.includes("titular")) return { rank: 5, label: "Titular" };
    if (t.includes("suplente")) return { rank: 4, label: "Suplente" };
    return { rank: 1, label: "Membro" };
  };

  const findDeputyIdByNameFuzzy = (name) => {
    const key = normalizeNameKey(name);
    if (!key) return null;
    const exact = deputyIdByNameFold.get(key);
    if (exact) return exact;

    // remove sufixos comuns de composição (partido/UF etc.)
    const cleaned = key
      .replace(/\b(pp|pl|pt|psb|psd|mdb|pdt|republicanos|uniao brasil|uniao|psol|novo|avante|podemos)\b/g, " ")
      .replace(/\b(ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) return null;
    const tokens = cleaned.split(" ").filter((t) => t.length >= 3);
    if (!tokens.length) return null;

    for (const row of deputyNameIndex) {
      const ok = tokens.every((t) => row.key.includes(t));
      if (ok) return row.id;
    }
    return null;
  };

  const resolveMemberToDeputyId = (m) => {
    // Na API, em /orgaos/{id}/membros o campo `id` costuma ser o id numérico do deputado.
    if (m?.id != null && m.id !== "") {
      const key = String(m.id).trim();
      const byId = deputyIdByNumeric.get(key);
      if (byId) return byId;
    }
    const fromUri = extractNumericFromAny(m?.uri || m?.uriDeputado || m?.uriMembro || m?.uriPessoa);
    if (fromUri) {
      const byUri = deputyIdByNumeric.get(fromUri);
      if (byUri) return byUri;
    }
    const nameCandidates = [m?.nome, m?.nomeParlamentar, m?.nomeCivil];
    for (const n of nameCandidates) {
      const byName = findDeputyIdByNameFuzzy(n);
      if (byName) return byName;
    }
    return null;
  };

  const loadCommissionMembers = async (commissionId) => {
    if (!commissionId) {
      clearMemberMarks();
      return;
    }
    try {
      memberDeputyIds.clear();
      memberRoleByDeputyId.clear();

      const perPage = 100;
      let page = 1;
      /** @type {any[]} */
      const allRows = [];
      while (page <= 30) {
        const url =
          `https://dadosabertos.camara.leg.br/api/v2/orgaos/${encodeURIComponent(commissionId)}/membros` +
          `?itens=${perPage}&pagina=${page}`;
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) break;
        const data = await res.json();
        const arr = Array.isArray(data?.dados) ? data.dados : [];
        if (!arr.length) break;
        allRows.push(...arr);
        if (arr.length < perPage) break;
        page += 1;
      }

      for (const m of allRows) {
        const depId = resolveMemberToDeputyId(m);
        if (!depId) continue;
        memberDeputyIds.add(depId);
        const nextRole = getMemberRoleFromRow(m);
        const currentRole = memberRoleByDeputyId.get(depId) || null;
        if (!currentRole || nextRole.rank > currentRole.rank) {
          memberRoleByDeputyId.set(depId, nextRole);
        }
      }
      rerenderGrid();
      rerenderDeputyList();
    } catch {
      clearMemberMarks();
    }
  };

  const loadCommissions = async () => {
    if (!commissionTypeEl || !commissionSelectEl) return;
    commissionSelectEl.innerHTML = `<option value="">Carregando comissões...</option>`;
    commissionSelectEl._customSelectSync?.();
    try {
      /** @type {{id:string,name:string,type:string}[]} */
      const out = [];
      const base = "https://dadosabertos.camara.leg.br/api/v2/orgaos";
      let page = 1;
      const perPage = 100;
      while (page <= 20) {
        const url = `${base}?itens=${perPage}&pagina=${page}&ordem=ASC&ordenarPor=sigla`;
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) break;
        const data = await res.json();
        const arr = Array.isArray(data?.dados) ? data.dados : [];
        if (!arr.length) break;
        for (const o of arr) {
          if (!isCommissionActive(o)) continue;
          const type = classifyCommissionType(o);
          if (!type) continue;
          const id = String(o.id || "");
          if (!id) continue;
          out.push({
            id,
            name: String(o.apelido || o.sigla || o.nome || `Órgão ${id}`),
            type
          });
        }
        if (arr.length < perPage) break;
        page += 1;
      }

      allCommissions = out;
      const pref = loadCommissionUiPref();
      const type = pref?.type || commissionTypeEl.value || "permanente";
      commissionTypeEl.value = type;
      setCommissionOptions(type, pref?.commissionId || null);
      if (!commissionSelectEl.value) {
        setCommissionOptions(type, null);
      }
      saveCommissionUiPref(commissionTypeEl.value, commissionSelectEl.value || "");
      if (commissionSelectEl.value) {
        await loadCommissionMembers(commissionSelectEl.value);
      } else {
        clearMemberMarks();
      }
      commissionTypeEl._customSelectSync?.();
      commissionSelectEl._customSelectSync?.();
    } catch {
      commissionSelectEl.innerHTML = `<option value="">Falha ao carregar comissões</option>`;
      clearMemberMarks();
      commissionTypeEl._customSelectSync?.();
      commissionSelectEl._customSelectSync?.();
    }
  };

  const updatePreview = () => {
    const text = safeText(paste.value);
    if (!text.trim()) {
      preview.textContent = "Nenhum texto colado ainda.";
      return;
    }
    const parsed = parseDeputiesFromPdfText(text);
    preview.textContent = `${parsed.length} deputados detectados.`;
  };

  $("#btnImportDeputies").addEventListener("click", () => {
    paste.value = "";
    updatePreview();
    deputiesDialog.showModal();
    setTimeout(() => paste.focus(), 0);
  });

  paste.addEventListener("input", updatePreview);

  $("#btnDeputiesApply").addEventListener("click", () => {
    const parsed = parseDeputiesFromPdfText(paste.value);
    if (!parsed.length) {
      alert("Não consegui extrair deputados. Cole o texto completo do PDF (incluindo as linhas 'PARTIDO - UF').");
      return;
    }
    // Se estiver no modo do servidor local, enriquece automaticamente com líder/vice-líder
    // para as cores funcionarem mesmo após importação via PDF.
    enrichDeputiesWithLeadership(parsed)
      .then((enriched) => {
        saveDeputiesToStorage(enriched);
        location.reload();
      })
      .catch(() => {
        saveDeputiesToStorage(parsed);
        location.reload();
      });
  });

  $("#btnDeputiesClear").addEventListener("click", () => {
    if (!confirm("Voltar para a lista de exemplo? (Isso não apaga o mapa de alocação.)")) return;
    saveDeputiesToStorage(null);
    location.reload();
  });

  const seatLabelFromKey = (layout, key) => {
    for (const s of layout.seats) {
      if (seatFingerprint(s) === key) return s.label;
    }
    return key;
  };

  const findDeputyAllocations = async (depId) => {
    /** @type {{layoutId:string, layoutName:string, seatLabel:string}[]} */
    const found = [];

    const checks = allLayouts.map(async (layout) => {
      /** @type {Record<string, string|null>} */
      let allocations = {};

      if (SHARED_SYNC_ENABLED) {
        try {
          const remote = await fetchSharedState(layout.id);
          if (remote?.allocations && typeof remote.allocations === "object") {
            allocations = remote.allocations;
          }
        } catch {
          // fallback local abaixo
        }
      }

      if (!allocations || Object.keys(allocations).length === 0) {
        allocations = loadState(layout).allocations;
      }

      for (const [seatKey, value] of Object.entries(allocations)) {
        if (value === depId) {
          found.push({
            layoutId: layout.id,
            layoutName: layout.name,
            seatLabel: seatLabelFromKey(layout, seatKey)
          });
          break;
        }
      }
    });

    await Promise.all(checks);
    return found.sort((a, b) => Number(a.layoutId) - Number(b.layoutId));
  };

  const setFindDeputyResult = (text) => {
    if (findDeputyResult) findDeputyResult.textContent = text;
  };

  const rerenderFindDeputyList = () => {
    const q = normalize(findDeputySearch?.value || "");
    const filtered = deputies.filter((d) => {
      if (!q) return true;
      return normalize(d.nome).includes(q);
    });
    renderDeputyListInto(findDeputyList, filtered, findDeputySelectedId, async (dep) => {
      findDeputySelectedId = dep.id;
      rerenderFindDeputyList();
      setFindDeputyResult(`Procurando ${dep.nome} em todos os plenários...`);
      const found = await findDeputyAllocations(dep.id);
      if (!found.length) {
        const seatedWord = inferSeatedWordByName(dep.nome);
        setFindDeputyResult(`${dep.nome} não está ${seatedWord} em nenhum dos 16 plenários.`);
        return;
      }
      const msg = found.map((f) => `Plenário ${f.layoutId} (cadeira ${f.seatLabel})`).join(" | ");
      const word = inferAllocatedWordByName(dep.nome);
      setFindDeputyResult(`${dep.nome} está ${word} em: ${msg}`);
    }, null);
  };

  $("#btnFindDeputy").addEventListener("click", () => {
    findDeputySelectedId = null;
    if (findDeputySearch) findDeputySearch.value = "";
    setFindDeputyResult("Selecione um deputado para localizar nos plenários.");
    rerenderFindDeputyList();
    findDeputyDialog.showModal();
    setTimeout(() => findDeputySearch?.focus(), 0);
  });

  findDeputySearch?.addEventListener("input", rerenderFindDeputyList);
  commissionTypeEl?.addEventListener("change", async () => {
    setCommissionOptions(commissionTypeEl.value, null);
    saveCommissionUiPref(commissionTypeEl.value, commissionSelectEl?.value || "");
    await loadCommissionMembers(commissionSelectEl?.value || "");
  });
  commissionSelectEl?.addEventListener("change", async () => {
    saveCommissionUiPref(commissionTypeEl?.value || "permanente", commissionSelectEl.value || "");
    await loadCommissionMembers(commissionSelectEl.value || "");
  });
  void loadCommissions();

  // Sync deputies from Câmara website (online)
  $("#btnSyncDeputies").addEventListener("click", async () => {
    try {
      if (location.protocol === "file:") {
        alert(
          "Para atualizar do site, abra o app via servidor local.\n\n" +
            "Na pasta 'plenarios-web', rode 'start-server.cmd' e abra:\n" +
            "http://localhost:5174/"
        );
        return;
      }

      const btn = $("#btnSyncDeputies");
      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = "Atualizando...";

      const list = await fetchAllDeputiesFromCamara();
      if (!list.length) {
        alert("Não consegui obter a lista (vazia).");
        return;
      }
      saveDeputiesToStorage(list);
      saveDeputiesMeta({ source: "Câmara (Dados Abertos)", updatedAt: Date.now(), count: list.length });
      saveCommissionUiPref(commissionTypeEl?.value || "permanente", commissionSelectEl?.value || "");
      location.reload();
      btn.textContent = oldText;
    } catch (e) {
      alert(String(e?.message || e));
    } finally {
      const btn = $("#btnSyncDeputies");
      btn.disabled = false;
      btn.textContent = "Atualizar do site";
    }
  });

  function setActiveLayoutById(id) {
    const next = allLayouts.find((l) => l.id === id) || allLayouts[0];
    currentLayout = next;
    if (currentPlenarioText) {
      currentPlenarioText.textContent = `Você está no Plenário ${currentLayout.id}`;
    }
    activeSeat = null;
    activeSeatKey = null;
    currentLayoutVersion = -1;
    state = loadState(currentLayout);
    rerenderGrid();
    refreshInspector();
    if (tabsRoot) {
      for (const btn of tabsRoot.querySelectorAll(".pillTab")) {
        btn.classList.toggle("pillTab--active", btn.dataset.layout === id);
      }
    }
    if (SHARED_SYNC_ENABLED) {
      void syncCurrentLayoutFromServer();
    }
  }

  async function syncCurrentLayoutFromServer() {
    try {
      const remote = await fetchSharedState(currentLayout.id);
      if (!remote) return;
      const remoteVersion = Number(remote.version || 0);
      if (remoteVersion <= currentLayoutVersion) return;
      currentLayoutVersion = remoteVersion;
      state = stateFromServer(currentLayout, remote.allocations);
      saveStateLocal(state);
      rerenderGrid();
      refreshInspector();
      updateStatus();
    } catch {
      // sem servidor compartilhado: mantém funcionamento local.
    }
  }

  if (tabsRoot) {
    tabsRoot.addEventListener("click", (e) => {
      const btn = e.target.closest(".pillTab");
      if (!btn) return;
      const id = btn.dataset.layout;
      if (!id) return;
      setActiveLayoutById(id);
    });
  }

  setActiveLayoutById("1");

  if (SHARED_SYNC_ENABLED) {
    void fetchLiderancasSnapshot().then(() => rerenderGrid());
    setInterval(() => {
      void fetchLiderancasSnapshot().then(() => rerenderGrid());
    }, 10 * 60 * 1000);

    setInterval(() => {
      if (!IS_LINUX_CLIENT && document.hidden) return;
      void syncCurrentLayoutFromServer();
    }, 3000);

    if (IS_LINUX_CLIENT) {
      window.addEventListener("focus", () => {
        void syncCurrentLayoutFromServer();
      });
      window.addEventListener("online", () => {
        void syncCurrentLayoutFromServer();
      });
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) void syncCurrentLayoutFromServer();
      });
    }
  }

  // Actions
  $("#deputySearch").addEventListener("input", rerenderDeputyList);

  $("#seatDialog")?.addEventListener("close", resetSeatDialogChrome);

  $("#btnAssignSelected").addEventListener("click", () => {
    if (!activeSeatKey) return;
    if (!selectedDeputyId) return;
    state.allocations[activeSeatKey] = selectedDeputyId;
    saveState(state);
    rerenderGrid();
    refreshInspector();
    updateStatus();
    $("#seatDialog").close();
  });

  $("#btnRemoveFromSeat").addEventListener("click", () => {
    if (!activeSeatKey) return;
    state.allocations[activeSeatKey] = null;
    saveState(state);
    rerenderGrid();
    refreshInspector();
    updateStatus();
    $("#seatDialog").close();
  });

  $("#btnClear").addEventListener("click", () => {
    if (!confirm("Limpar todas as alocações deste layout?")) return;
    const empty = createEmptyState(currentLayout);
    Object.assign(state, empty);
    saveState(state);
    rerenderGrid();
    refreshInspector();
    updateStatus();
  });

  // Place selected deputy on seat by clicking seat, without opening dialog:
  $("#seatGrid").addEventListener("dblclick", (e) => {
    const seatEl = e.target?.closest?.(".seat");
    if (!seatEl) return;
    const key = seatEl.dataset.seatKey;
    if (!key) return;
    if (!selectedDeputyId) return;
    state.allocations[key] = selectedDeputyId;
    saveState(state);
    updateStatus();
    rerenderGrid();
    refreshInspector();
  });

  // Initial render
  setSelectedDeputy(null);
  rerenderDeputyList();
  rerenderGrid();
  refreshInspector();
  updateStatus();
}

main().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<div style="padding:24px;font-family:system-ui;color:#fff">
    <h2 style="margin:0 0 10px 0">Falha ao iniciar</h2>
    <div style="opacity:.8">${String(e?.message || e)}</div>
    <div style="margin-top:12px;opacity:.7;font-size:12px">Verifique se você está abrindo via servidor (não apenas arquivo) e se os JSONs existem.</div>
  </div>`;
});

