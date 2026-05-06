# Deploy cloud (sem depender do seu computador)

Este passo a passo usa:
- Frontend no Netlify
- API serverless no Netlify Functions
- Estado compartilhado no Supabase

## 1) Criar tabela no Supabase
1. Abra o projeto no Supabase.
2. Vá em SQL Editor.
3. Rode o conteúdo do arquivo `SUPABASE_SETUP.sql` (inclui `plenario_state`, deputados proxy e tabelas **`liderancas_snapshot`** / **`liderancas_meta`** para o painel de lideranças).

## 2) Configurar variáveis no Netlify
No site criado no Netlify, em:
`Site settings > Environment variables`, criar:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- (Opcional) `LIDERANCAS_SYNC_SECRET` — se definido, `/api/liderancas-sync` exige header `Authorization: Bearer <segredo>` (recomendado em produção).

Use os valores do seu projeto Supabase.

## 3) Publicar esta pasta
Publique a pasta `plenarios-web-teste` no Netlify.

Este projeto já inclui:
- `netlify.toml`
- `netlify/functions/state.js`
- `netlify/functions/deputados.js`
- `netlify/functions/liderancas.js` (leitura do snapshot no Supabase)
- `netlify/functions/liderancas-sync.js` (scraping da página da Câmara + gravação no Supabase; agendamento em `netlify.toml`)

Rotas prontas:
- `/api/state`
- `/api/deputados`
- `/api/liderancas` — JSON com `dados` (lideranças ativas) e `meta` (última sync, erros, contagem)
- `/api/liderancas-sync` — dispara sync manualmente (`GET` ou `POST`); se `LIDERANCAS_SYNC_SECRET` estiver definida, envie o Bearer.

## 4) Testes rápidos após deploy
No domínio do Netlify:
1. `GET /api/deputados` deve retornar JSON com `dados`.
2. `GET /api/state?layoutId=3` deve retornar `dados` com `version`.
3. Abra o app em 2 navegadores e teste alocação no mesmo plenário.
4. **Lideranças:** após o primeiro deploy, rode uma sync (com segredo, se configurado):
   `curl -H "Authorization: Bearer SEU_SEGREDO" "https://SEU-SITE.netlify.app/api/liderancas-sync"`
   Depois `GET /api/liderancas` deve listar itens em `dados`. No app, aloque um deputado que conste como líder/vice na página oficial — ele deve aparecer no painel **“Líderes e Vice-Líderes alocados neste Plenário”**.

### Parser (local, sem rede)
Na pasta do projeto:
`node tools/test-liderancas-parse.cjs`

### Troubleshooting lideranças
- **`/api/liderancas` 500:** confira se o SQL das tabelas `liderancas_*` foi aplicado e se `SUPABASE_SERVICE_ROLE_KEY` está correta no Netlify.
- **Lista vazia no painel:** confirme sync (`/api/liderancas-sync`) e se o deputado alocado tem o mesmo id numérico da Câmara (`camara-123` na lista do app).
- **Sync 401:** definiu `LIDERANCAS_SYNC_SECRET` — inclua o header `Authorization: Bearer ...`.
- **HTML da Câmara mudou:** o parser pode retornar 0 linhas; a meta em `liderancas_meta` guarda `last_error`; ajuste `netlify/functions/liderancasParse.js`.

## 5) Observações
- Não mexe na produção local (porta 5173).
- Esta publicação é paralela para validação.
- Depois de validar, você distribui somente o link Netlify.

