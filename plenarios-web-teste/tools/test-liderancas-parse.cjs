/**
 * Teste offline do parser de lideranças (sem rede).
 * Uso: node tools/test-liderancas-parse.cjs
 */
const assert = require("assert");
const { parseLiderancasHtml, SOURCE_URL } = require("../netlify/functions/liderancasParse");

const htmlBasico = `
<body>
  <h4>Partido dos Testes - PDT</h4>
  <p><strong>Líder:</strong></p>
  <ul>
    <li><a href="https://www.camara.leg.br/deputados/999001">Fulano da Silva</a></li>
  </ul>
  <p><strong>Vice-Líderes:</strong></p>
  <ul>
    <li><a href="https://www.camara.leg.br/deputados/999002">Beltrana Souza</a></li>
  </ul>
  <h4>Bloco Parlamentar X - BLOCO</h4>
  <p><strong>Líder:</strong></p>
  <ul></ul>
  <p><strong>Vice-Líderes:</strong></p>
  <ul>
    <li><a href="https://www.camara.leg.br/deputados/999003">Ciclano</a></li>
  </ul>
  <h4>Governo</h4>
  <p><strong>Representante:</strong></p>
  <ul>
    <li><a href="https://www.camara.leg.br/deputados/999004">Rep Um</a></li>
  </ul>
</body>
`;

const rows = parseLiderancasHtml(htmlBasico, SOURCE_URL);
assert(rows.length >= 4, `esperado >= 4 linhas, veio ${rows.length}`);

const byId = new Map(rows.map((r) => [r.deputado_id_camara, r]));
assert.strictEqual(byId.get(999001).role_type, "lider");
assert.strictEqual(byId.get(999002).role_type, "vice_lider");
assert.strictEqual(byId.get(999003).role_type, "vice_lider");
assert.strictEqual(byId.get(999004).role_type, "representante");
assert.strictEqual(byId.get(999001).scope_type, "partido");
assert.strictEqual(byId.get(999003).scope_type, "bloco");
assert.strictEqual(byId.get(999004).scope_type, "governo");

/** Seção “Partidos que participam de Bloco Parlamentar”: não extrair líder de partido isolado. */
const htmlExcluiPartidoNoBloco = `
<body>
<h3><span>Líderes do Governo, da Minoria e de Partidos que participam de Bloco Parlamentar</span></h3>
<h4>Maioria - Maioria</h4>
<p><strong>Líder:</strong></p>
<ul><li><a href="https://www.camara.leg.br/deputados/880001">Líder Maioria</a></li></ul>
<h4>UNIÃO - União Brasil</h4>
<p><strong>Líder:</strong></p>
<ul><li><a href="https://www.camara.leg.br/deputados/880002">Líder Partido Bloco</a></li></ul>
</body>
`;
const rowsBloco = parseLiderancasHtml(htmlExcluiPartidoNoBloco, SOURCE_URL);
assert.strictEqual(rowsBloco.length, 1, "deve ignorar h4 de partido na seção de bloco parlamentar");
assert.strictEqual(rowsBloco[0].deputado_id_camara, 880001);
assert.strictEqual(rowsBloco[0].scope_type, "maioria");

/** PP citado em título de bloco: não importar h4 "PP - …" como partido (líder duplicado). */
const htmlBlocoExcluiPartidoPorSigla = `
<body>
<h3><span>Líderes e Vice-Líderes de blocos e partidos</span></h3>
<h4>UNIÃO, PP - Bloco Parlamentar UNIÃO, PP</h4>
<p><strong>Líder:</strong></p>
<ul><li><a href="https://www.camara.leg.br/deputados/770001">Líder do Bloco</a></li></ul>
<p><strong>Vice-Líderes:</strong></p>
<ul><li><a href="https://www.camara.leg.br/deputados/770002">Vice Bloco</a></li></ul>
<h4>PP - Progressistas</h4>
<p><strong>Líder:</strong></p>
<ul><li><a href="https://www.camara.leg.br/deputados/770003">Líder PP no bloco não querido</a></li></ul>
</body>
`;
const rowsSigla = parseLiderancasHtml(htmlBlocoExcluiPartidoPorSigla, SOURCE_URL);
const idsSigla = new Set(rowsSigla.map((r) => r.deputado_id_camara));
assert.ok(idsSigla.has(770001), "líder do bloco");
assert.ok(idsSigla.has(770002), "vice do bloco");
assert.ok(!idsSigla.has(770003), "líder só do partido PP integrante de bloco deve ser ignorado");

/** Travessão Unicode (U+2013) como na página da Câmara. */
const htmlTravessao = `
<body>
<h3><span>Blocos</span></h3>
<h4>UNIÃO, PP \u2013 Bloco Parlamentar UNIÃO, PP</h4>
<p><strong>Líder:</strong></p>
<ul><li><a href="https://www.camara.leg.br/deputados/660001">Líder Bloco</a></li></ul>
<h4>PP \u2013 Progressistas</h4>
<p><strong>Líder:</strong></p>
<ul><li><a href="https://www.camara.leg.br/deputados/660002">Não deve entrar</a></li></ul>
</body>
`;
const rowsDash = parseLiderancasHtml(htmlTravessao, SOURCE_URL);
const idsDash = new Set(rowsDash.map((r) => r.deputado_id_camara));
assert.ok(idsDash.has(660001) && !idsDash.has(660002), "travessão Unicode deve acionar filtro PP");

/** Mesmo deputado: vice no bloco + líder de partido que não está no título do bloco → cai só o líder partido. */
const htmlMesmoDepBlocoEPartido = `
<body>
<h3><span>Blocos</span></h3>
<h4>UNIÃO, MDB - Bloco Parlamentar X</h4>
<p><strong>Líder:</strong></p>
<ul><li><a href="https://www.camara.leg.br/deputados/550001">Outro</a></li></ul>
<p><strong>Vice-Líderes:</strong></p>
<ul><li><a href="https://www.camara.leg.br/deputados/550099">Mesmo Dep</a></li></ul>
<h3><span>Outros</span></h3>
<h4>PL - Partido Liberal</h4>
<p><strong>Líder:</strong></p>
<ul><li><a href="https://www.camara.leg.br/deputados/550099">Mesmo Dep</a></li></ul>
</body>
`;
const rowsSame = parseLiderancasHtml(htmlMesmoDepBlocoEPartido, SOURCE_URL);
const mesmaPessoa = rowsSame.filter((r) => r.deputado_id_camara === 550099);
assert.strictEqual(mesmaPessoa.length, 1, "só vice do bloco; líder PL cai por regra bloco+partido");
assert.strictEqual(mesmaPessoa[0].role_type, "vice_lider");

/** Mesmo deputado listado como Líder e Vice no mesmo h4 de bloco: manter só vice. */
const htmlLiderEViceMesmoBloco = `
<body>
<h3><span>Blocos</span></h3>
<h4>Bloco Teste - BT</h4>
<p><strong>Líder:</strong></p>
<ul>
  <li><a href="https://www.camara.leg.br/deputados/440001">Dup Nome</a></li>
</ul>
<p><strong>Vice-Líderes:</strong></p>
<ul>
  <li><a href="https://www.camara.leg.br/deputados/440001">Dup Nome</a></li>
</ul>
</body>
`;
const rowsDupBloco = parseLiderancasHtml(htmlLiderEViceMesmoBloco, SOURCE_URL);
assert.strictEqual(rowsDupBloco.length, 1, "duplicata líder+vice mesmo bloco: uma linha");
assert.strictEqual(rowsDupBloco[0].role_type, "vice_lider");
assert.strictEqual(rowsDupBloco[0].deputado_id_camara, 440001);

console.log(
  "test-liderancas-parse: OK",
  rows.length + rowsBloco.length + rowsSigla.length + rowsDash.length + rowsSame.length,
  "linhas (5 cenários)"
);
