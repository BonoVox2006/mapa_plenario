const { parseLiderancasSoapXml, LIDERANCAS_SOAP_URL } = require("./liderancasSoap");

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: jsonHeaders, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Use GET" })
    };
  }
  try {
    const res = await fetch(LIDERANCAS_SOAP_URL, { headers: { Accept: "application/xml,text/xml,*/*" } });
    if (!res.ok) {
      return {
        statusCode: 502,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "Falha no webservice da Câmara", detail: `HTTP ${res.status}` })
      };
    }
    const xml = await res.text();
    const dados = parseLiderancasSoapXml(xml);
    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        ok: true,
        source: "soap",
        count: dados.length,
        dados,
        fetchedAt: new Date().toISOString()
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Falha ao ler lideranças", detail: String(err?.message || err) })
    };
  }
};
