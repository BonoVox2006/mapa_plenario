const crypto = require("crypto");
const { parseLiderancasHtml, SOURCE_URL } = require("./liderancasParse");

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

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

async function supabaseRequest(path, options = {}) {
  const supabaseUrl = getEnvOrThrow("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = getEnvOrThrow("SUPABASE_SERVICE_ROLE_KEY");
  const url = `${supabaseUrl}/rest/v1/${path}`;
  const { method = "GET", body, prefer } = options;

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? body : undefined
  });
  return res;
}

async function runSync() {
  const res = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": "MapaPlenarioBot/1.0 (+https://netlify.com)",
      Accept: "text/html,application/xhtml+xml"
    }
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Falha ao baixar página da Câmara: ${res.status} ${t.slice(0, 200)}`);
  }
  const html = await res.text();
  const sourceHash = crypto.createHash("sha256").update(html, "utf8").digest("hex");

  const rows = parseLiderancasHtml(html, SOURCE_URL);
  if (!rows.length) {
    throw new Error("Parser não extraiu nenhuma liderança (HTML pode ter mudado).");
  }

  const capturedAt = new Date().toISOString();
  for (const r of rows) {
    r.source_hash = sourceHash;
    r.captured_at = capturedAt;
  }

  const patchRes = await supabaseRequest("liderancas_snapshot?active=eq.true", {
    method: "PATCH",
    prefer: "return=minimal",
    body: JSON.stringify({ active: false })
  });
  if (!patchRes.ok) {
    const d = await patchRes.text();
    throw new Error(`Falha ao desativar snapshot anterior: ${patchRes.status} ${d}`);
  }

  const upsertRes = await supabaseRequest("liderancas_snapshot?on_conflict=row_key", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: JSON.stringify(rows)
  });
  if (!upsertRes.ok) {
    const d = await upsertRes.text();
    throw new Error(`Falha ao gravar snapshot: ${upsertRes.status} ${d}`);
  }

  const metaRes = await supabaseRequest("liderancas_meta?id=eq.1", {
    method: "PATCH",
    prefer: "return=minimal",
    body: JSON.stringify({
      last_success_at: capturedAt,
      last_error: null,
      last_error_at: null,
      last_source_hash: sourceHash,
      last_item_count: rows.length
    })
  });
  if (!metaRes.ok) {
    const d = await metaRes.text();
    throw new Error(`Falha ao atualizar meta: ${metaRes.status} ${d}`);
  }

  return { count: rows.length, sourceHash, capturedAt };
}

async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: jsonHeaders, body: "" };
  }

  const secret = process.env.LIDERANCAS_SYNC_SECRET;
  if (secret) {
    const auth = event.headers?.authorization || event.headers?.Authorization;
    if (auth !== `Bearer ${secret}`) {
      return response(401, { error: "Não autorizado" });
    }
  }

  try {
    if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
      return response(405, { error: "Use GET ou POST" });
    }

    const out = await runSync();
    return response(200, { ok: true, ...out, sourceUrl: SOURCE_URL });
  } catch (err) {
    const msg = String(err?.message || err);
    try {
      await supabaseRequest("liderancas_meta?id=eq.1", {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({
          last_error: msg.slice(0, 2000),
          last_error_at: new Date().toISOString()
        })
      });
    } catch {
      // ignore
    }
    return response(500, { ok: false, error: msg });
  }
}

module.exports = { handler };
