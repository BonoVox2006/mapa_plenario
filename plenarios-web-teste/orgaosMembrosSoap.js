/**
 * Parser do webservice ObterMembrosOrgao (Câmara / Infoleg).
 * A API REST /orgaos/{id}/membros costuma ficar desatualizada; o SOAP é a fonte usada no Infoleg.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.parseOrgaoMembrosSoapXml = api.parseOrgaoMembrosSoapXml;
    root.orgaoMembrosSoapUrl = api.orgaoMembrosSoapUrl;
  }
})(typeof self !== "undefined" ? self : this, function () {
  function orgaoMembrosSoapUrl(orgaoId) {
    return `https://www.camara.leg.br/SitCamaraWS/Orgaos.asmx/ObterMembrosOrgao?IDOrgao=${encodeURIComponent(orgaoId)}`;
  }

  function stripTags(s) {
    return String(s || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function xmlField(block, tag) {
    const m = String(block || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
    return m ? stripTags(m[1]) : "";
  }

  function parseOrgaoMembrosSoapXml(xml) {
    const rows = [];
    const blockRe = /<(Titular|Suplente)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = blockRe.exec(xml)) !== null) {
      const role = m[1];
      const body = m[2];
      const id = xmlField(body, "ideCadastro");
      const nome = xmlField(body, "nome");
      if (!id || !nome) continue;
      const titulo = xmlField(body, "situacao") || role;
      rows.push({
        id: String(id),
        uri: `https://dadosabertos.camara.leg.br/api/v2/deputados/${id}`,
        nome,
        siglaPartido: xmlField(body, "partido").trim(),
        siglaUf: xmlField(body, "uf").trim(),
        titulo
      });
    }
    return rows;
  }

  return { parseOrgaoMembrosSoapXml, orgaoMembrosSoapUrl };
});
