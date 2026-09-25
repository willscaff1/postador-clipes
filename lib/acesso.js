// Login do painel. No PC fica desligado (so voce acessa, em localhost).
// Na nuvem e obrigatorio: sem SENHA_PAINEL o servidor nem sobe.
// A sessao e um cookie assinado (HMAC) que vale 30 dias.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ambiente = require('./ambiente');

const ARQ_CHAVE = path.join(ambiente.DADOS, 'sessao.chave');
const DIAS = 30;
let chaveCache = null;

function chave() {
  if (chaveCache) return chaveCache;
  try { chaveCache = fs.readFileSync(ARQ_CHAVE); } catch (e) {
    fs.mkdirSync(ambiente.DADOS, { recursive: true });
    chaveCache = crypto.randomBytes(32);
    fs.writeFileSync(ARQ_CHAVE, chaveCache, { mode: 0o600 });
  }
  return chaveCache;
}

const ativo = () => !!ambiente.SENHA;
const assinar = (exp) => crypto.createHmac('sha256', chave()).update('sessao:' + exp).digest('hex');
const seguro = () => (ambiente.BASE_URL && ambiente.BASE_URL.startsWith('https') ? '; Secure' : '');

function cookieEntrada() {
  const exp = Date.now() + DIAS * 86400000;
  return `postador=${exp}.${assinar(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DIAS * 86400}${seguro()}`;
}
const cookieSaida = () => `postador=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${seguro()}`;

function logado(req) {
  if (!ativo()) return true;
  const m = /(?:^|;\s*)postador=(\d+)\.([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m || Number(m[1]) < Date.now()) return false;
  const a = Buffer.from(assinar(m[1])); const b = Buffer.from(m[2]);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// no maximo 8 tentativas erradas a cada 10 min por IP
const tentativas = new Map();
function ipDe(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function conferir(req, senha) {
  const ip = ipDe(req);
  const agora = Date.now();
  const t = (tentativas.get(ip) || []).filter((x) => agora - x < 600000);
  if (t.length >= 8) return { ok: false, erro: 'Muitas tentativas. Espere uns minutos.' };
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  const ok = crypto.timingSafeEqual(h(senha), h(ambiente.SENHA));
  if (!ok) { t.push(agora); tentativas.set(ip, t); return { ok: false, erro: 'Senha errada.' }; }
  tentativas.delete(ip);
  return { ok: true };
}

function pagina(erro) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar · Postador de Clipes</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 "Segoe UI",system-ui,sans-serif;background:radial-gradient(120% 80% at 0% 0%,#2a1650,#0c0b12 60%);color:#ece9f5;padding:16px}
main{width:min(360px,100%);background:#15131e;border:1px solid #2a2638;border-radius:18px;padding:28px;box-shadow:0 30px 80px rgba(0,0,0,.45)}
.logo{width:44px;height:44px;border-radius:13px;background:linear-gradient(135deg,#8b5cf6,#c026d3);display:grid;place-items:center;margin-bottom:14px}
.logo svg{width:20px;fill:#fff;margin-left:3px}
h1{margin:0 0 4px;font-size:21px}p{margin:0 0 18px;color:#9d97b3;font-size:14px}
input{width:100%;box-sizing:border-box;font:inherit;color:#ece9f5;background:#1e1b2a;border:1px solid #2a2638;border-radius:11px;padding:11px 13px;margin-bottom:12px}
input:focus{outline:none;border-color:#a078ff}
button{width:100%;font:inherit;font-weight:700;border:0;border-radius:11px;padding:11px;background:linear-gradient(135deg,#8b5cf6,#c026d3);color:#fff;cursor:pointer}
.erro{background:#341518;color:#f87171;border-radius:10px;padding:8px 12px;font-size:13.5px;margin-bottom:12px}
</style>
<main><div class="logo"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
<h1>Postador de Clipes</h1><p>Digite a senha do painel pra entrar.</p>
${erro ? `<div class="erro">${esc(erro)}</div>` : ''}
<form method="post" action="/login"><input type="password" name="senha" placeholder="Senha" autofocus autocomplete="current-password" required><button>Entrar</button></form>
</main></html>`;
}

module.exports = { ativo, logado, conferir, pagina, cookieEntrada, cookieSaida };
