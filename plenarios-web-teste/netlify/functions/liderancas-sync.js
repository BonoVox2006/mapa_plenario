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

/** Data civil em America/Sao_Paulo (YYYY-MM-DD). */
function getSaoPauloYmd(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  const d = parts.find((p) => p.type === "day").value;
  return `${y}-${m}-${d}`;
}

function isWeekendSaoPaulo(now = new Date()) {
  const w = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short"
  }).format(now);
  return w === "Sat" || w === "Sun";
}

/** Hora local 0–23 em America/Sao_Paulo. */
function getSaoPauloHour(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "numeric",
    hourCycle: "h23"
  }).formatToParts(now);
  return Number(parts.find((p) => p.type === "hour").value);
}

let holidayNationalSetCache = { year: null, set: null };

/** @returns {Promise<Set<string>|null>} datas YYYY-MM-DD ou null se falhar */
async function getNationalHolidayDateSet(year) {
  if (holidayNationalSetCache.year === year && holidayNationalSetCache.set) {
    return holidayNationalSetCache.set;
  }
  const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`, {
    headers: { Accept: "application/json" }
  });
  if (!res.ok) return null;
  const arr = await res.json();
  if (!Array.isArray(arr)) return null;
  const set = new Set(arr.filter((h) => h.type === "national").map((h) => h.date));
  holidayNationalSetCache = { year, set };
  return set;
}

/**
 * Não roda: fim de semana; fora de 8h–19h em America/Sao_Paulo; feriado nacional (Brasil API).
 * Se a API de feriados falhar, não bloqueia por feriado (evita ficar sem sync).
 * LIDERANCAS_SYNC_FORCE=true ignora fim de semana, feriado e janela de horário.
 */
async function shouldSkipLiderancasSync(now = new Date()) {
  const force = /^1|true$/i.test(String(process.env.LIDERANCAS_SYNC_FORCE || ""));
  if (force) return { skip: false };

  if (isWeekendSaoPaulo(now)) {
    return {
      skip: true,
      reason: "weekend",
      detail: "Fim de semana (America/Sao_Paulo)."
    };
  }

  const hourSp = getSaoPauloHour(now);
  if (hourSp < 8 || hourSp > 19) {
    return {
      skip: true,
      reason: "outside_business_hours",
      detail: `Fora do horário 8h–19h (America/Sao_Paulo); agora ${hourSp}h.`
    };
  }

  const ymd = getSaoPauloYmd(now);
  const year = Number(ymd.slice(0, 4));
  const holidaySet = await getNationalHolidayDateSet(year);
  if (!holidaySet) {
    return { skip: false };
  }
  if (holidaySet.has(ymd)) {
    return {
      skip: true,
      reason: "holiday",
      detail: `Feriado nacional (${ymd}).`
    };
  }
  return { skip: false };
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

    const skipInfo = await shouldSkipLiderancasSync();
    if (skipInfo.skip) {
      return response(200, {
        ok: true,
        skipped: true,
        reason: skipInfo.reason,
        detail: skipInfo.detail,
        sourceUrl: SOURCE_URL
      });
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
