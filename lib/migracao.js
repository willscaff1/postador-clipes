// Leva o painel do PC pro painel online (Railway) de uma vez: usuarios (com a
// mesma senha, so o hash viaja), contas das redes e preferencias.
//
// O painel online so aceita com o codigo SENHA_PAINEL (variavel do Railway) e
// por HTTPS. Os tokens das redes continuam valendo la (a renovacao nao depende
// do endereco), entao nao precisa conectar rede por rede.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ambiente = require('./ambiente');
const cofre = require('./cofre');
const acesso = require('./acesso');

const ARQ_PREFS = path.join(cofre.DADOS, 'preferencias.json');
const tentativas = [];

function lerPrefs() { try { return JSON.parse(fs.readFileSync(ARQ_PREFS, 'utf8')); } catch (e) { return {}; } }

// ---------- lado do PC ----------
async function enviar(destino, codigo) {
  let url;
  try { url = new URL(String(destino || '').trim()); } catch (e) { throw new Error('Endereco do painel online invalido.'); }
  if (url.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) throw new Error('O painel online tem que ser https://');
  const usuarios = acesso.exportarUsuarios();
  if (usuarios.some((u) => u.trocarSenha)) throw new Error('Tem usuario com senha provisoria. Crie a senha dele (ou a sua) antes de enviar.');
  const corpo = JSON.stringify({ tipo: 'postador-migracao', versao: 1, usuarios, contas: cofre.todas(), preferencias: lerPrefs() });
  let r;
  try {
    r = await fetch(url.origin + '/api/migrar/receber', {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json', 'X-Postador': '1', Authorization: 'Bearer ' + String(codigo || '').trim() },
      body: corpo,
    });
  } catch (e) { throw new Error('Nao consegui falar com o painel online (' + (e.cause && e.cause.code || e.message) + '). Ele ja esta no ar?'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || 'O painel online respondeu ' + r.status);
  return j;
}

// ---------- lado do painel online ----------
async function receber(req, res, json) {
  if (!ambiente.NUVEM || !ambiente.SENHA) return json(res, 404, { erro: 'Esse painel nao recebe transferencia.' });
  const agora = Date.now();
  while (tentativas.length && agora - tentativas[0] > 15 * 60000) tentativas.shift();
  if (tentativas.length >= 10) return json(res, 429, { erro: 'Muitas tentativas. Espere 15 minutos.' });
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  const codigo = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!crypto.timingSafeEqual(h(codigo), h(ambiente.SENHA))) { tentativas.push(agora); return json(res, 401, { erro: 'Codigo errado (e o valor de SENHA_PAINEL no Railway).' }); }
  let texto = '';
  for await (const d of req) { texto += d; if (texto.length > 5e6) return json(res, 413, { erro: 'Pacote grande demais.' }); }
  let p;
  try { p = JSON.parse(texto); } catch (e) { return json(res, 400, { erro: 'Pacote invalido.' }); }
  if (!p || p.tipo !== 'postador-migracao' || !Array.isArray(p.usuarios) || !p.usuarios.length) return json(res, 400, { erro: 'Pacote invalido.' });
  try {
    acesso.importarUsuarios(p.usuarios);
    const redes = [];
    for (const [plat, campos] of Object.entries(p.contas || {})) {
      if (campos && typeof campos === 'object' && Object.keys(campos).length) { cofre.substituir(plat, campos); redes.push(plat); }
    }
    if (p.preferencias && typeof p.preferencias === 'object') cofre.gravarAtomico(ARQ_PREFS, JSON.stringify({ ...lerPrefs(), ...p.preferencias }, null, 2));
    return json(res, 200, { ok: true, usuarios: p.usuarios.map((u) => u.usuario), redes });
  } catch (e) { return json(res, 400, { erro: e.message }); }
}

module.exports = { enviar, receber };
