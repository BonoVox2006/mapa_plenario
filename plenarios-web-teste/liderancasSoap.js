/**
 * Parser do webservice ObterLideresBancadas (Câmara).
 * Usado no browser e na Netlify Function.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.parseLiderancasSoapXml = api.parseLiderancasSoapXml;
    root.LIDERANCAS_SOAP_URL = api.LIDERANCAS_SOAP_URL;
  }
})(typeof self !== "undefined" ? self : this, function () {
  const LIDERANCAS_SOAP_URL =
    "https://www.camara.leg.br/SitCamaraWS/Deputados.asmx/ObterLideresBancadas";

  function stripTags(s) {
    return String(s || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function xmlAttr(attrs, name) {
    const m = String(attrs || "").match(new RegExp(name + '\\s*=\\s*"([^"]*)"', "i"));
    return m ? m[1] : "";
  }

  function xmlField(block, tag) {
    const m = String(block || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
    return m ? stripTags(m[1]) : "";
  }

  function classifySoapBancada(sigla, nome) {
    const s = `${sigla} ${nome}`
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (s.includes("governo")) return "governo";
    if (s.includes("oposi")) return "oposicao";
    if (s.includes("maioria")) return "maioria";
    if (s.includes("minoria")) return "minoria";
    if (s.includes("bloco") || String(sigla).includes(",")) return "bloco";
    if (s.includes("federacao") || /^fdr\b/i.test(String(sigla))) return "federacao";
    return "partido";
  }

  function partyHead(sigla) {
    return String(sigla || "")
      .split(",")[0]
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "");
  }

  function pushRole(rows, scopeType, scopeName, scopeSigla, roleType, block) {
    const id = Number(xmlField(block, "ideCadastro"));
    const nome = xmlField(block, "nome");
    if (!id || !nome) return;
    rows.push({
      scope_type: scopeType,
      scope_name: scopeName,
      scope_sigla: scopeSigla || null,
      role_type: roleType,
      deputado_id_camara: id,
      deputado_nome: nome,
      sigla_partido: xmlField(block, "partido") || null,
      uf: xmlField(block, "uf") || null,
      scope_label: `${roleType === "vice_lider" ? "Vice-líder" : "Líder"} — ${String(scopeName).split(" - ")[0]}`
    });
  }

  function parseLiderancasSoapXml(xml) {
    const rows = [];
    const blocoPartyHeads = new Set();
    const bancadaRe = /<bancada\b([^>]*)>([\s\S]*?)<\/bancada>/gi;
    let m;
    const bancadas = [];
    while ((m = bancadaRe.exec(xml)) !== null) {
      bancadas.push({ attrs: m[1], body: m[2] });
    }
    for (const b of bancadas) {
      const sigla = xmlAttr(b.attrs, "sigla");
      const nome = xmlAttr(b.attrs, "nome") || sigla;
      if (classifySoapBancada(sigla, nome) === "bloco") {
        String(sigla)
          .split(",")
          .map((p) => partyHead(p))
          .filter(Boolean)
          .forEach((p) => blocoPartyHeads.add(p));
      }
    }
    for (const b of bancadas) {
      const sigla = xmlAttr(b.attrs, "sigla");
      const nome = xmlAttr(b.attrs, "nome") || sigla;
      let scopeType = classifySoapBancada(sigla, nome);
      const scopeName = nome || sigla;
      if (scopeType === "partido" && blocoPartyHeads.has(partyHead(sigla))) {
        scopeType = "partido_bloco";
      }
      const lider = b.body.match(/<lider\b[^>]*>([\s\S]*?)<\/lider>/i);
      if (lider) pushRole(rows, scopeType, scopeName, sigla, "lider", lider[1]);
      const viceRe = /<vice_lider\b[^>]*>([\s\S]*?)<\/vice_lider>/gi;
      let v;
      while ((v = viceRe.exec(b.body)) !== null) {
        pushRole(rows, scopeType, scopeName, sigla, "vice_lider", v[1]);
      }
    }
    return rows;
  }

  return { parseLiderancasSoapXml, LIDERANCAS_SOAP_URL };
});
