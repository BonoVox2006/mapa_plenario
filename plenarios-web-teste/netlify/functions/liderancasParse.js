const crypto = require("crypto");

const SOURCE_URL =
  "https://www.camara.leg.br/deputados/liderancas-e-bancadas-partidarias/lideres-e-vice-lideres-dos-partidos";

function stripTags(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyScope(scopeName) {
  const s = String(scopeName || "").toLowerCase();
  if (s.includes("governo")) return "governo";
  if (s.includes("oposi")) return "oposicao";
  if (s.includes("maioria")) return "maioria";
  if (s.includes("minoria")) return "minoria";
  if (s.includes("bloco parlamentar")) return "bloco";
  if (s.includes("federação") || s.includes("federacao") || /^fdr\s/i.test(String(scopeName || "").trim()))
    return "federacao";
  return "partido";
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
 * Extrai blocos <h4>…</h4> seguidos de Líder / Vice-Líderes / Representante.
 * @param {string} html
 * @param {string} sourceUrl
 */
function parseLiderancasHtml(html, sourceUrl) {
  /** @type {any[]} */
  const rows = [];
  const h4re = /<h4[^>]*>([\s\S]*?)<\/h4>/gi;
  const matches = [];
  let m;
  while ((m = h4re.exec(html)) !== null) {
    matches.push({ inner: m[1], index: m.index, fullLen: m[0].length });
  }

  for (let i = 0; i < matches.length; i++) {
    const scopeName = stripTags(matches[i].inner);
    if (!scopeName || scopeName.length < 3) continue;

    const start = matches[i].index + matches[i].fullLen;
    const end = i + 1 < matches.length ? matches[i + 1].index : html.length;
    const blockHtml = html.slice(start, end);
    const scopeType = classifyScope(scopeName);

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

  return rows;
}

module.exports = { parseLiderancasHtml, SOURCE_URL };
