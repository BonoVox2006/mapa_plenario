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

console.log("test-liderancas-parse: OK", rows.length, "linhas");
