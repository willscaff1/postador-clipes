// Login do painel: usuarios com senha (scrypt), sessoes guardadas no servidor
// (da pra ver os aparelhos conectados e derrubar) e dois papeis:
//   admin  -> tudo, inclusive contas das redes e usuarios
//   editor -> corta, posta e ve metricas; nao mexe em contas nem usuarios
//
// Primeiro acesso: sem nenhum usuario, a tela pede pra criar o administrador.
// Na nuvem isso exige o codigo SENHA_PAINEL (variavel do Railway), pra ninguem
// que achar o link antes de voce virar dono do painel.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ambiente = require('./ambiente');

const ARQ_USUARIOS = path.join(ambiente.DADOS, 'usuarios.json');
const ARQ_SESSOES = path.join(ambiente.DADOS, 'sessoes.json');
const DIAS = 30;
const COOKIE = 'postador_s';

let usuarios = null;
let sessoes = null;

function ler(arq) { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch (e) { return []; } }
function gravar(arq, dados) {
  fs.mkdirSync(ambiente.DADOS, { recursive: true });
  const tmp = arq + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, arq);
}
function listaUsuarios() { if (!usuarios) usuarios = ler(ARQ_USUARIOS); return usuarios; }
function listaSessoes() {
  if (!sessoes) sessoes = ler(ARQ_SESSOES);
  const agora = Date.now();
  const antes = sessoes.length;
  sessoes = sessoes.filter((s) => s.expira > agora && listaUsuarios().some((u) => u.id === s.usuarioId));
  if (sessoes.length !== antes) gravar(ARQ_SESSOES, sessoes);
  return sessoes;
}
const salvarUsuarios = () => gravar(ARQ_USUARIOS, listaUsuarios());
let gravarSessoesDepois = null;
function salvarSessoes(agora) {
  if (agora) { clearTimeout(gravarSessoesDepois); gravarSessoesDepois = null; return gravar(ARQ_SESSOES, listaSessoes()); }
  if (!gravarSessoesDepois) gravarSessoesDepois = setTimeout(() => { gravarSessoesDepois = null; gravar(ARQ_SESSOES, listaSessoes()); }, 5000);
}

// ---------- senha ----------
function hashSenha(senha, sal = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(String(senha), sal, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { sal, hash: h };
}
function senhaConfere(u, senha) {
  const { hash } = hashSenha(senha, u.sal);
  const a = Buffer.from(hash, 'hex'); const b = Buffer.from(u.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function validarSenha(senha) {
  const s = String(senha || '');
  if (s.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  if (s.length > 200) throw new Error('Senha longa demais.');
  if (/^(.)\1+$/.test(s) || /^(12345678|password|senha123|qwerty12)/i.test(s)) throw new Error('Essa senha e facil demais. Escolha outra.');
}
function validarUsuario(nome) {
  const u = String(nome || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(u)) throw new Error('Usuario: 3 a 32 letras, numeros, ponto, traco ou sublinhado (sem espaco).');
  return u;
}

// ---------- limite de tentativas ----------
const tentativas = new Map();
function bloqueado(chave) {
  const agora = Date.now();
  const t = (tentativas.get(chave) || []).filter((x) => agora - x < 15 * 60000);
  tentativas.set(chave, t);
  return t.length >= 8;
}
function errou(chave) { tentativas.set(chave, [...(tentativas.get(chave) || []), Date.now()]); }
function ipDe(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }

// ---------- sessao ----------
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const seguro = () => (ambiente.BASE_URL && ambiente.BASE_URL.startsWith('https') ? '; Secure' : '');
function aparelho(req) {
  const ua = String(req.headers['user-agent'] || '');
  const so = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Outro';
  const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return nav + ' no ' + so;
}
function abrirSessao(req, u) {
  const token = crypto.randomBytes(32).toString('base64url');
  const s = {
    id: crypto.randomBytes(8).toString('hex'), token: hashToken(token), usuarioId: u.id,
    criadaEm: Date.now(), ultimoUso: Date.now(), expira: Date.now() + DIAS * 86400000, ip: ipDe(req), aparelho: aparelho(req),
  };
  listaSessoes().push(s);
  u.ultimoAcesso = new Date().toISOString();
  salvarUsuarios();
  salvarSessoes(true);
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DIAS * 86400}${seguro()}`;
}
const cookieSaida = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${seguro()}`;

function sessaoDe(req) {
  const m = new RegExp('(?:^|;\\s*)' + COOKIE + '=([A-Za-z0-9_-]{20,})').exec(req.headers.cookie || '');
  if (!m) return null;
  const h = hashToken(m[1]);
  const s = listaSessoes().find((x) => x.token === h);
  if (!s) return null;
  const u = listaUsuarios().find((x) => x.id === s.usuarioId);
  if (!u) return null;
  if (Date.now() - s.ultimoUso > 60000) { s.ultimoUso = Date.now(); s.ip = ipDe(req); salvarSessoes(); }
  return { sessao: s, usuario: u };
}

// ---------- telas ----------
const precisaPrimeiroAcesso = () => !listaUsuarios().length;
const exigeCodigo = () => ambiente.NUVEM;
const podeSubir = () => !ambiente.NUVEM || listaUsuarios().length > 0 || !!ambiente.SENHA;

function publico(u) {
  return { id: u.id, usuario: u.usuario, nome: u.nome, papel: u.papel, criadoEm: u.criadoEm, ultimoAcesso: u.ultimoAcesso || null };
}

function entrar(req, usuario, senha) {
  const ip = ipDe(req);
  const nome = String(usuario || '').trim().toLowerCase();
  if (bloqueado('ip:' + ip) || bloqueado('u:' + nome)) return { erro: 'Muitas tentativas. Espere 15 minutos.' };
  const u = listaUsuarios().find((x) => x.usuario === nome);
  // confere a senha mesmo sem usuario (mesmo tempo de resposta, nao entrega quem existe)
  const ok = u ? senhaConfere(u, senha) : (hashSenha(senha, 'x'), false);
  if (!ok) { errou('ip:' + ip); errou('u:' + nome); return { erro: 'Usuário ou senha errados.' }; }
  return { cookie: abrirSessao(req, u) };
}

function criarPrimeiro(req, { nome, usuario, senha, codigo }) {
  if (!precisaPrimeiroAcesso()) throw new Error('O administrador ja foi criado. Entre com ele.');
  if (exigeCodigo()) {
    const ip = ipDe(req);
    if (bloqueado('ip:' + ip)) throw new Error('Muitas tentativas. Espere 15 minutos.');
    const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
    if (!ambiente.SENHA || !crypto.timingSafeEqual(h(codigo), h(ambiente.SENHA))) { errou('ip:' + ip); throw new Error('Codigo de instalacao errado (e o valor de SENHA_PAINEL no Railway).'); }
  }
  const u = criarUsuario({ nome, usuario, senha, papel: 'admin' });
  return { cookie: abrirSessao(req, u) };
}

function criarUsuario({ nome, usuario, senha, papel }) {
  const login = validarUsuario(usuario);
  if (listaUsuarios().some((x) => x.usuario === login)) throw new Error('Ja existe um usuario "' + login + '".');
  validarSenha(senha);
  const u = {
    id: crypto.randomBytes(6).toString('hex'), usuario: login, nome: String(nome || login).trim().slice(0, 60) || login,
    papel: papel === 'admin' ? 'admin' : 'editor', criadoEm: new Date().toISOString(), ...hashSenha(senha),
  };
  listaUsuarios().push(u);
  salvarUsuarios();
  return u;
}

function exigirAdmin(quem) { if (!quem || quem.usuario.papel !== 'admin') throw new Error('So o administrador pode fazer isso.'); }

// ---------- gerencia (pagina Acesso) ----------
function resumo(quem) {
  const minhas = listaSessoes().filter((s) => quem.usuario.papel === 'admin' || s.usuarioId === quem.usuario.id);
  return {
    eu: publico(quem.usuario),
    sessaoAtual: quem.sessao.id,
    usuarios: quem.usuario.papel === 'admin' ? listaUsuarios().map(publico) : null,
    sessoes: minhas.sort((a, b) => b.ultimoUso - a.ultimoUso).map((s) => ({
      id: s.id, usuarioId: s.usuarioId, usuario: (listaUsuarios().find((u) => u.id === s.usuarioId) || {}).usuario,
      aparelho: s.aparelho, ip: s.ip, criadaEm: new Date(s.criadaEm).toISOString(), ultimoUso: new Date(s.ultimoUso).toISOString(),
    })),
    nuvem: ambiente.NUVEM,
  };
}

function trocarMinhaSenha(quem, { atual, nova }) {
  if (!senhaConfere(quem.usuario, atual)) throw new Error('A senha atual nao confere.');
  validarSenha(nova);
  Object.assign(quem.usuario, hashSenha(nova));
  salvarUsuarios();
  // derruba os outros aparelhos: quem tinha a senha antiga perde o acesso
  sessoes = listaSessoes().filter((s) => s.usuarioId !== quem.usuario.id || s.id === quem.sessao.id);
  salvarSessoes(true);
}

function atualizarUsuario(quem, id, { nome, papel, novaSenha }) {
  exigirAdmin(quem);
  const u = listaUsuarios().find((x) => x.id === id);
  if (!u) throw new Error('Usuario nao encontrado.');
  if (typeof nome === 'string' && nome.trim()) u.nome = nome.trim().slice(0, 60);
  if (papel && papel !== u.papel) {
    if (u.papel === 'admin' && listaUsuarios().filter((x) => x.papel === 'admin').length < 2) throw new Error('Tem que sobrar pelo menos um administrador.');
    u.papel = papel === 'admin' ? 'admin' : 'editor';
  }
  if (novaSenha) {
    validarSenha(novaSenha);
    Object.assign(u, hashSenha(novaSenha));
    sessoes = listaSessoes().filter((s) => s.usuarioId !== u.id || s.id === quem.sessao.id);
    salvarSessoes(true);
  }
  salvarUsuarios();
  return publico(u);
}

function removerUsuario(quem, id) {
  exigirAdmin(quem);
  if (id === quem.usuario.id) throw new Error('Voce nao pode remover a si mesmo.');
  const u = listaUsuarios().find((x) => x.id === id);
  if (!u) throw new Error('Usuario nao encontrado.');
  if (u.papel === 'admin' && listaUsuarios().filter((x) => x.papel === 'admin').length < 2) throw new Error('Tem que sobrar pelo menos um administrador.');
  usuarios = listaUsuarios().filter((x) => x.id !== id);
  salvarUsuarios();
  sessoes = listaSessoes().filter((s) => s.usuarioId !== id);
  salvarSessoes(true);
}

function encerrarSessao(quem, id) {
  const s = listaSessoes().find((x) => x.id === id);
  if (!s) return;
  if (s.usuarioId !== quem.usuario.id) exigirAdmin(quem);
  sessoes = listaSessoes().filter((x) => x.id !== id);
  salvarSessoes(true);
}

function sairDosOutros(quem) {
  sessoes = listaSessoes().filter((s) => s.usuarioId !== quem.usuario.id || s.id === quem.sessao.id);
  salvarSessoes(true);
}

function sair(req) {
  const q = sessaoDe(req);
  if (q) { sessoes = listaSessoes().filter((s) => s.id !== q.sessao.id); salvarSessoes(true); }
}

// ---------- HTML da tela de login ----------
function pagina({ erro, primeiro } = {}) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const campoSenha = (nome, rotulo, auto) => `<label>${rotulo}<span class="senha"><input type="password" name="${nome}" autocomplete="${auto}" required minlength="${primeiro ? 8 : 1}"><button type="button" class="olho" aria-label="Mostrar senha">👁</button></span></label>`;
  const corpo = primeiro
    ? `<h1>Primeiro acesso</h1><p>Crie a conta do administrador do painel.</p>
      ${erro ? `<div class="erro">${esc(erro)}</div>` : ''}
      <form method="post" action="/primeiro-acesso">
        <label>Seu nome<input name="nome" autocomplete="name" required></label>
        <label>Usuário<input name="usuario" autocomplete="username" required pattern="[A-Za-z0-9._-]{3,32}" placeholder="ex.: willscaff"></label>
        ${campoSenha('senha', 'Senha (mínimo 8)', 'new-password')}
        ${exigeCodigo() ? '<label>Código de instalação<input type="password" name="codigo" required placeholder="o valor de SENHA_PAINEL no Railway"></label>' : ''}
        <button>Criar e entrar</button>
      </form>`
    : `<h1>Postador de Clipes</h1><p>Entre com seu usuário e senha.</p>
      ${erro ? `<div class="erro">${esc(erro)}</div>` : ''}
      <form method="post" action="/login">
        <label>Usuário<input name="usuario" autocomplete="username" autofocus required></label>
        ${campoSenha('senha', 'Senha', 'current-password')}
        <button>Entrar</button>
      </form>`;
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${primeiro ? 'Primeiro acesso' : 'Entrar'} · Postador de Clipes</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 "Segoe UI",system-ui,sans-serif;background:radial-gradient(120% 80% at 0% 0%,#2a1650,#0c0b12 60%);color:#ece9f5;padding:16px}
main{width:min(380px,100%);background:#15131e;border:1px solid #2a2638;border-radius:20px;padding:30px;box-shadow:0 30px 80px rgba(0,0,0,.45)}
.logo{width:46px;height:46px;border-radius:14px;background:linear-gradient(135deg,#8b5cf6,#c026d3);display:grid;place-items:center;margin-bottom:16px;box-shadow:0 8px 24px rgba(192,38,211,.4)}
.logo svg{width:20px;fill:#fff;margin-left:3px}
h1{margin:0 0 4px;font-size:22px;letter-spacing:-.01em}p{margin:0 0 18px;color:#9d97b3;font-size:14px}
label{display:grid;gap:5px;font-size:13px;font-weight:600;color:#c9c3dd;margin-bottom:12px}
input{width:100%;font:inherit;font-weight:400;color:#ece9f5;background:#1e1b2a;border:1px solid #2a2638;border-radius:11px;padding:11px 13px}
input:focus{outline:none;border-color:#a078ff;box-shadow:0 0 0 3px rgba(160,120,255,.2)}
.senha{position:relative;display:block}.senha input{padding-right:44px}
.olho{position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:0;color:#9d97b3;cursor:pointer;font-size:16px;padding:6px}
form>button{width:100%;font:inherit;font-weight:700;border:0;border-radius:11px;padding:12px;margin-top:4px;background:linear-gradient(135deg,#8b5cf6,#c026d3);color:#fff;cursor:pointer}
form>button:hover{filter:brightness(1.08)}
.erro{background:#341518;color:#f87171;border-radius:10px;padding:9px 12px;font-size:13.5px;margin-bottom:14px}
.rodape{margin:16px 0 0;font-size:12px;color:#6f6887;text-align:center}
</style>
<main><div class="logo"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>${corpo}
<p class="rodape">🔒 Conexão protegida · senhas guardadas com criptografia</p></main>
<script>document.querySelectorAll('.olho').forEach(function(b){b.onclick=function(){var i=b.previousElementSibling;i.type=i.type==='password'?'text':'password';}})</script></html>`;
}

module.exports = {
  sessaoDe, entrar, criarPrimeiro, precisaPrimeiroAcesso, podeSubir, pagina, cookieSaida, sair,
  resumo, trocarMinhaSenha, criarUsuario, atualizarUsuario, removerUsuario, encerrarSessao, sairDosOutros, exigirAdmin, publico,
};
