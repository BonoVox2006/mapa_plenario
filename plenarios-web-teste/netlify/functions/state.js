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

  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  return res;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: jsonHeaders, body: "" };
  }

  try {
    if (event.httpMethod === "GET") {
      const layoutId = event.queryStringParameters?.layoutId;
      if (!layoutId) return response(400, { error: "layoutId obrigatório" });

      const query =
        `plenario_state?layout_id=eq.${encodeURIComponent(layoutId)}` +
        "&select=layout_id,allocations,version,updated_at&limit=1";
      const res = await supabaseRequest(query, { method: "GET" });
      if (!res.ok) {
        const detail = await res.text();
        return response(500, { error: "Falha ao ler estado", detail });
      }

      const rows = await res.json();
      const row = Array.isArray(rows) && rows.length ? rows[0] : null;
      if (!row) {
        return response(200, {
          dados: { layoutId, allocations: {}, version: 0, updatedAt: null }
        });
      }

      return response(200, {
        dados: {
          layoutId: row.layout_id,
          allocations: row.allocations || {},
          version: Number(row.version || 0),
          updatedAt: row.updated_at || null
        }
      });
    }

    if (event.httpMethod === "POST") {
      if (!event.body) return response(400, { error: "Body JSON obrigatório" });
      const payload = JSON.parse(event.body);
      const layoutId = String(payload?.layoutId || "").trim();
      const allocations =
        payload && payload.allocations && typeof payload.allocations === "object"
          ? payload.allocations
          : null;
      if (!layoutId) return response(400, { error: "layoutId obrigatório" });
      if (!allocations) return response(400, { error: "allocations obrigatório" });

      const selectRes = await supabaseRequest(
        `plenario_state?layout_id=eq.${encodeURIComponent(layoutId)}&select=version&limit=1`,
        { method: "GET" }
      );
      if (!selectRes.ok) {
        const detail = await selectRes.text();
        return response(500, { error: "Falha ao ler versão atual", detail });
      }
      const rows = await selectRes.json();
      const prevVersion = Array.isArray(rows) && rows.length ? Number(rows[0].version || 0) : 0;
      const nextVersion = prevVersion + 1;
      const updatedAt = new Date().toISOString();

      const upsertRes = await supabaseRequest("plenario_state?on_conflict=layout_id", {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify([
          {
            layout_id: layoutId,
            allocations,
            version: nextVersion,
            updated_at: updatedAt
          }
        ])
      });
      if (!upsertRes.ok) {
        const detail = await upsertRes.text();
        return response(500, { error: "Falha ao gravar estado", detail });
      }

      const outRows = await upsertRes.json();
      const out = Array.isArray(outRows) && outRows.length ? outRows[0] : null;
      return response(200, {
        ok: true,
        dados: {
          layoutId: out?.layout_id || layoutId,
          allocations: out?.allocations || allocations,
          version: Number(out?.version || nextVersion),
          updatedAt: out?.updated_at || updatedAt
        }
      });
    }

    return response(405, { error: "Método não suportado" });
  } catch (err) {
    return response(500, { error: "Falha no estado compartilhado", detail: String(err?.message || err) });
  }
};

