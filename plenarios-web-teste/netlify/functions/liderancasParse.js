const crypto = require("crypto");

const SOURCE_URL =
  "https://www.camara.leg.br/deputados/liderancas-e-bancadas-partidarias/lideres-e-vice-lideres-dos-partidos";

function stripTags(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Hífen ASCII e travessões comuns (página da Câmara costuma usar – em vez de -). */
function normalizeDashes(s) {
  return String(s || "").replace(/[\u2013\u2014\u2212]/g, "-");
}

function classifyScope(scopeName) {
  const s = normalizeDashes(stripTags(scopeName)).toLowerCase();
  if (s.includes("governo")) return "governo";
  if (s.includes("oposi")) return "oposicao";
  if (s.includes("maioria")) return "maioria";
  if (s.includes("minoria")) return "minoria";
  if (s.includes("bloco parlamentar")) return "bloco";
  if (s.includes("federação") || s.includes("federacao") || /^fdr\s/i.test(String(scopeName || "").trim()))
    return "federacao";
  return "partido";
}

/** Título de <h3> sem acentos, minúsculo. */
function normalizeSectionTitle(html) {
  const text = stripTags(html)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

/**
 * Na seção "Líderes do Governo… Partidos que participam de Bloco Parlamentar",
 * a Câmara repete líderes de cada partido membro de bloco — isso não entra na ferramenta.
 * Mantém só Governo, Maioria, Oposição e Minoria (e quaisquer h4 que não sejam `partido`).
 */
function sectionExcludesPartyOnlyH4(h3InnerHtml) {
  const t = normalizeSectionTitle(h3InnerHtml);
  return (
    t.includes("participam de bloco parlamentar") ||
    (t.includes("participam de bloco") && t.includes("partido"))
  );
}

/** Chave estável para comparar sigla de partido (sem acento, minúsculo). */
function normalizePartyKey(s) {
  return stripTags(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Partes antes de " - Bloco Parlamentar …" separadas por vírgula (siglas/nomes no título do bloco).
 */
function partyTokensFromBlocoTitle(scopeName) {
  const raw = normalizeDashes(stripTags(scopeName));
  const m = raw.match(/(.+?)\s*-\s*Bloco\s+Parlamentar\b/i);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Primeiro trecho do h4 de partido: "PP - Progressistas" → "PP" (aceita – ou -). */
function partidoHeadKey(scopeName) {
  const flat = normalizeDashes(stripTags(scopeName));
  const head = flat.split(/\s*-\s*/)[0].trim();
  return normalizePartyKey(head);
}

/**
 * Siglas/partidos citados em títulos de Bloco Parlamentar (1ª seção e quaisquer outros).
 * Usado para não importar líder/vice do h4 "PP - …" quando o PP integra um bloco.
 */
function collectPartyKeysInBlocoTitles(segments) {
  const set = new Set();
  for (const seg of segments) {
    const h4re = /<h4[^>]*>([\s\S]*?)<\/h4>/gi;
    let m;
    while ((m = h4re.exec(seg.body)) !== null) {
      const scopeName = normalizeDashes(stripTags(m[1]));
      if (classifyScope(scopeName) !== "bloco") continue;
      for (const tok of partyTokensFromBlocoTitle(scopeName)) {
        const k = normalizePartyKey(tok);
        if (k) set.add(k);
      }
    }
  }
  return set;
}

function buildScopeLabel(roleType, scopeName) {
  const rolePt =
    roleType === "vice_lider" ? "Vice-líder" : roleType === "representante" ? "Representante" : "Líder";
  const short = String(scopeName || "").split(" - ")[0]?.trim() || scopeName;
  return `${rolePt} — ${short}`;
}

function rowKey(scopeType, scopeName, roleType, deputadoId, deputadoNome) {
  const base = `${scopeType}|${scopeName}|${roleType}|${deputadoId}|${String(deputadoNome).toLowerCase().trim()}`;
  return crypto.createHash("sha256").update(base, "utf8").digest("hex").slice(0, 48);
}

function extractLinksFromUl(ulHtml) {
  const out = [];
  if (!ulHtml) return out;
  const re =
    /<a[^>]+href="https?:\/\/www\.camara\.leg\.br\/deputados\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(ulHtml)) !== null) {
    const id = Number(m[1]);
    const nome = stripTags(m[2]);
    if (id && nome) out.push({ id, nome });
  }
  return out;
}

function extractSection(html, strongLabel) {
  const escaped = strongLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<strong>\\s*${escaped}\\s*:<\\/strong>\\s*<ul>([\\s\\S]*?)<\\/ul>`,
    "i"
  );
  const m = html.match(re);
  return m ? m[1] : "";
}

/**
 * Extrai blocos <h4>…</h4> (Líder / Vice-Líderes / Representante) dentro de cada <h3>.
 * Ignora, na seção “…Partidos que participam de Bloco Parlamentar”, apenas linhas de partido isolado
 * (líder institucional do partido no bloco), mantendo Governo/Maioria/Oposição/Minoria.
 * @param {string} html
 * @param {string} sourceUrl
 */
function parseLiderancasHtml(html, sourceUrl) {
  /** @type {any[]} */
  const rows = [];

  const h3Matches = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)];
  /** @type {{ title: string; body: string; excludePartyH4: boolean }[]} */
  const segments = [];

  if (h3Matches.length === 0) {
    segments.push({ title: "", body: html, excludePartyH4: false });
  } else {
    let cursor = 0;
    for (let i = 0; i < h3Matches.length; i++) {
      const m = h3Matches[i];
      if (m.index > cursor) {
        segments.push({ title: "", body: html.slice(cursor, m.index), excludePartyH4: false });
      }
      const bodyStart = m.index + m[0].length;
      const bodyEnd = i + 1 < h3Matches.length ? h3Matches[i + 1].index : html.length;
      segments.push({
        title: m[1],
        body: html.slice(bodyStart, bodyEnd),
        excludePartyH4: sectionExcludesPartyOnlyH4(m[1])
      });
      cursor = bodyEnd;
    }
    if (cursor < html.length) {
      segments.push({ title: "", body: html.slice(cursor), excludePartyH4: false });
    }
  }

  const partidosQueEstaoEmBloco = collectPartyKeysInBlocoTitles(segments);

  for (const seg of segments) {
    const h4re = /<h4[^>]*>([\s\S]*?)<\/h4>/gi;
    const matches = [];
    let m;
    while ((m = h4re.exec(seg.body)) !== null) {
      matches.push({ inner: m[1], index: m.index, fullLen: m[0].length });
    }

    for (let i = 0; i < matches.length; i++) {
      const scopeName = normalizeDashes(stripTags(matches[i].inner));
      if (!scopeName || scopeName.length < 3) continue;

      const start = matches[i].index + matches[i].fullLen;
      const end = i + 1 < matches.length ? matches[i + 1].index : seg.body.length;
      const blockHtml = seg.body.slice(start, end);
      const scopeType = classifyScope(scopeName);

      if (seg.excludePartyH4 && scopeType === "partido") continue;

      if (
        scopeType === "partido" &&
        partidosQueEstaoEmBloco.size > 0 &&
        partidosQueEstaoEmBloco.has(partidoHeadKey(scopeName))
      ) {
        continue;
      }

      const leaders = extractSection(blockHtml, "Líder");
      const vices = extractSection(blockHtml, "Vice-Líderes");
      const reps = extractSection(blockHtml, "Representante");

      for (const link of extractLinksFromUl(leaders)) {
        rows.push({
          row_key: rowKey(scopeType, scopeName, "lider", link.id, link.nome),
          scope_type: scopeType,
          scope_name: scopeName,
          role_type: "lider",
          deputado_id_camara: link.id,
          deputado_nome: link.nome,
          sigla_partido: null,
          uf: null,
          scope_label: buildScopeLabel("lider", scopeName),
          source_url: sourceUrl,
          active: true
        });
      }
      for (const link of extractLinksFromUl(vices)) {
        rows.push({
          row_key: rowKey(scopeType, scopeName, "vice_lider", link.id, link.nome),
          scope_type: scopeType,
          scope_name: scopeName,
          role_type: "vice_lider",
          deputado_id_camara: link.id,
          deputado_nome: link.nome,
          sigla_partido: null,
          uf: null,
          scope_label: buildScopeLabel("vice_lider", scopeName),
          source_url: sourceUrl,
          active: true
        });
      }
      for (const link of extractLinksFromUl(reps)) {
        rows.push({
          row_key: rowKey(scopeType, scopeName, "representante", link.id, link.nome),
          scope_type: scopeType,
          scope_name: scopeName,
          role_type: "representante",
          deputado_id_camara: link.id,
          deputado_nome: link.nome,
          sigla_partido: null,
          uf: null,
          scope_label: buildScopeLabel("representante", scopeName),
          source_url: sourceUrl,
          active: true
        });
      }
    }
  }

  return dropPartidoRowsListedInBlocos(rows, partidosQueEstaoEmBloco);
}

/**
 * Rede de segurança: remove linhas scope_type partido cuja sigla está no conjunto dos blocos
 * (caso algum h4 tenha escapado na etapa anterior).
 */
function dropPartidoRowsListedInBlocos(rows, partidosQueEstaoEmBloco) {
  if (!partidosQueEstaoEmBloco.size) return rows;
  return rows.filter((r) => {
    if (r.scope_type !== "partido") return true;
    const k = partidoHeadKey(r.scope_name);
    return !partidosQueEstaoEmBloco.has(k);
  });
}

module.exports = { parseLiderancasHtml, SOURCE_URL };
