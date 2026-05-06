const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const CACHE_MS = 10 * 60 * 1000;
let cache = { at: 0, payload: null };

function response(statusCode, bodyObj) {
  return {
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(bodyObj)
  };
}

function getEnvOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

async function supabaseRequest(path) {
  const supabaseUrl = getEnvOrThrow("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = getEnvOrThrow("SUPABASE_SERVICE_ROLE_KEY");
  const url = `${supabaseUrl}/rest/v1/${path}`;

  return fetch(url, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    }
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: jsonHeaders, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return response(405, { error: "Método não suportado" });
  }

  try {
    const now = Date.now();
    if (cache.payload && now - cache.at < CACHE_MS) {
      return response(200, { ...cache.payload, cached: true });
    }

    const [snapRes, metaRes] = await Promise.all([
      supabaseRequest(
        "liderancas_snapshot?active=eq.true&select=row_key,scope_type,scope_name,role_type,deputado_id_camara,deputado_nome,sigla_partido,uf,scope_label,captured_at&order=scope_name.asc"
      ),
      supabaseRequest("liderancas_meta?id=eq.1&select=*")
    ]);

    if (!snapRes.ok) {
      const d = await snapRes.text();
      return response(500, { error: "Falha ao ler lideranças", detail: d });
    }
    const rows = await snapRes.json();
    let meta = null;
    if (metaRes.ok) {
      const m = await metaRes.json();
      meta = Array.isArray(m) && m.length ? m[0] : null;
    }

    const payload = {
      dados: Array.isArray(rows) ? rows : [],
      meta: {
        lastSuccessAt: meta?.last_success_at || null,
        lastError: meta?.last_error || null,
        lastErrorAt: meta?.last_error_at || null,
        lastItemCount: Number(meta?.last_item_count || 0)
      },
      cached: false
    };
    cache = { at: now, payload };
    return response(200, payload);
  } catch (err) {
    return response(500, { error: "Falha em /api/liderancas", detail: String(err?.message || err) });
  }
};
