# Deploy cloud (sem depender do seu computador)

Este passo a passo usa:
- Frontend no Netlify
- API serverless no Netlify Functions
- Estado compartilhado no Supabase

## 1) Criar tabela no Supabase
1. Abra o projeto no Supabase.
2. Vá em SQL Editor.
3. Rode o conteúdo do arquivo `SUPABASE_SETUP.sql`.

## 2) Configurar variáveis no Netlify
No site criado no Netlify, em:
`Site settings > Environment variables`, criar:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Use os valores do seu projeto Supabase.

## 3) Publicar esta pasta
Publique a pasta `plenarios-web-teste` no Netlify.

Este projeto já inclui:
- `netlify.toml`
- `netlify/functions/state.js`
- `netlify/functions/deputados.js`

Rotas prontas:
- `/api/state`
- `/api/deputados`

## 4) Testes rápidos após deploy
No domínio do Netlify:
1. `GET /api/deputados` deve retornar JSON com `dados`.
2. `GET /api/state?layoutId=3` deve retornar `dados` com `version`.
3. Abra o app em 2 navegadores e teste alocação no mesmo plenário.

## 5) Observações
- Não mexe na produção local (porta 5173).
- Esta publicação é paralela para validação.
- Depois de validar, você distribui somente o link Netlify.

