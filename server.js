// Postador de clipes — no PC abre em http://localhost:8790 (so escuta no proprio PC).
// Na nuvem (Railway) escuta em 0.0.0.0 e exige senha: veja lib/ambiente.js.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cofre = require('./lib/cofre');
const { esconder } = require('./lib/http');
const plataformas = require('./lib/plataformas');
const clipes = require('./lib/clipes');
const postagens = require('./lib/postagens');
const midia = require('./lib/midia');
const twitch = require('./lib/plataformas/twitch');

const ambiente = require('./lib/ambiente');
const acesso = require('./lib/acesso');

const PORTA = ambiente.PORTA;
const PUBLICO = path.join(__dirname, 'public');
const HOSTS = ambiente.hostsPermitidos();
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.ico': 'image/x-icon',
};
const pedidosOAuth = new Map();

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function corpoJson(req) {
  return new Promise((resolve, reject) => {
    let t = '';
    req.on('data', (d) => { t += d; if (t.length > 1e6) { req.destroy(); reject(new Error('Corpo grande demais.')); } });
    req.on('end', () => { try { resolve(t ? JSON.parse(t) : {}); } catch (e) { reject(new Error('JSON invalido.')); } });
    req.on('error', reject);
  });
}

function servirArquivo(req, res, arquivo) {
  let st;
  try { st = fs.statSync(arquivo); } catch (e) { res.writeHead(404); return res.end('Nao encontrado'); }
  if (!st.isFile()) { res.writeHead(404); return res.end('Nao encontrado'); }
  const tipo = TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream';
  const faixa = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (faixa && (faixa[1] || faixa[2])) {
    let ini = faixa[1] ? Number(faixa[1]) : st.size - Number(faixa[2]);
    let fim = faixa[1] && faixa[2] ? Number(faixa[2]) : st.size - 1;
    ini = Math.max(0, ini); fim = Math.min(fim, st.size - 1);
    if (ini > fim) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
    res.writeHead(206, { 'Content-Type': tipo, 'Content-Length': fim - ini + 1, 'Content-Range': `bytes ${ini}-${fim}/${st.size}`, 'Accept-Ranges': 'bytes' });
    return fs.createReadStream(arquivo, { start: ini, end: fim }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': tipo, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
  fs.createReadStream(arquivo).pipe(res);
}

function paginaSimples(res, titulo, texto, ok) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>body{font:16px system-ui;background:#111318;color:#e8eaf0;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:520px;padding:32px;border-radius:14px;background:#1b1e26}h1{font-size:20px;color:${ok ? '#4ade80' : '#f87171'}}a{color:#8ab4ff}</style>
<main><h1>${esc(titulo)}</h1><p>${esc(texto)}</p><p><a href="${ambiente.urlBase()}/#contas">Voltar pro painel</a></p></main>
${ok ? `<script>setTimeout(()=>location.href='${ambiente.urlBase()}/#contas',1500)</script>` : ''}`);
}

async function testarConta(id) {
  const m = plataformas.obter(id);
  try {
    const r = await m.testar(cofre.obter(id), { salvar: (c) => cofre.atualizar(id, c) });
    return cofre.gravarStatus(id, { ok: true, conta: r.conta });
  } catch (e) {
    return cofre.gravarStatus(id, { ok: false, mensagem: esconder(e.message) });
  }
}

function clipePublico(c) {
  const { arquivo, miniatura, caminhoOriginal, ...resto } = c;
  return { ...resto, temMiniatura: !!miniatura, arquivoLocal: caminhoOriginal || null };
}

const rotas = [];
function rota(metodo, padrao, fn) {
  rotas.push({ metodo, re: new RegExp('^' + padrao.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });
}

rota('GET', '/api/estado', (req) => ({
  eu: acesso.publico(req.quem.usuario),
  porta: PORTA, nuvem: ambiente.NUVEM, ferramentas: { ...midia.ferramentas(), legendas: require('./lib/legendas').modelo() }, plataformas: plataformas.resumo(PORTA),
}));

rota('POST', '/api/contas/:id', async (req, p) => {
  const m = plataformas.obter(p.id);
  if (!m) throw new Error('Plataforma desconhecida.');
  const corpo = await corpoJson(req);
  const aceitos = {};
  for (const c of m.campos) if (!c.automatico && c.nome in (corpo.campos || {})) aceitos[c.nome] = corpo.campos[c.nome];
  const cred = cofre.atualizar(p.id, aceitos);
  // Algumas plataformas transformam o que foi colado (ex.: token do Explorer da Meta
  // vira token permanente da Pagina e ainda configura o Instagram ligado a ela).
  const extras = [];
  if (m.aoSalvar) {
    const saida = await m.aoSalvar(cred);
    for (const [plat, campos] of Object.entries(saida || {})) {
      cofre.atualizar(plat, campos);
      if (plat !== p.id) extras.push(plat);
    }
  }
  const r = plataformas.resumo(PORTA).find((x) => x.id === p.id);
  const teste = r.conectado ? await testarConta(p.id) : null;
  const outros = {};
  for (const plat of extras) outros[plat] = await testarConta(plat);
  return { ok: true, teste, outros };
});

rota('POST', '/api/contas/:id/testar', async (req, p) => {
  if (!plataformas.obter(p.id)) throw new Error('Plataforma desconhecida.');
  return testarConta(p.id);
});

rota('DELETE', '/api/contas/:id', (req, p) => { cofre.remover(p.id); return { ok: true }; });

rota('GET', '/oauth/:id/iniciar', async (req, p, u, res) => {
  const m = plataformas.obter(p.id);
  if (!m || !m.oauth) throw new Error('Essa plataforma nao usa Conectar.');
  const estado = crypto.randomBytes(16).toString('hex');
  const extra = {};
  let destino;
  try { destino = await m.urlAutorizacao(cofre.obter(p.id), m.redirect(), estado, extra); } catch (e) { return paginaSimples(res, 'Nao deu pra conectar', esconder(e.message), false); }
  pedidosOAuth.set(estado, { plat: p.id, extra, criadoEm: Date.now() });
  res.writeHead(302, { Location: destino });
  res.end();
});

rota('GET', '/oauth/:id/callback', async (req, p, u, res) => {
  const m = plataformas.obter(p.id);
  const q = Object.fromEntries(u.searchParams);
  // OAuth 1.0a (X) nao devolve state: acha o pedido pelo token temporario.
  if (!q.state && (q.oauth_token || q.denied)) {
    const tokenTemp = q.oauth_token || q.denied;
    for (const [k, v] of pedidosOAuth) if (v.extra.tokenTemp === tokenTemp) q.state = k;
  }
  const pedido = pedidosOAuth.get(q.state);
  pedidosOAuth.delete(q.state);
  if (!m || !pedido || pedido.plat !== p.id || Date.now() - pedido.criadoEm > 15 * 60000) {
    return paginaSimples(res, 'Conexao expirada', 'Volte ao painel e clique em Conectar de novo.', false);
  }
  if (q.error) return paginaSimples(res, 'Autorizacao recusada', q.error_description || q.error, false);
  try {
    const novos = await m.concluirAutorizacao(cofre.obter(p.id), q, m.redirect(), pedido.extra);
    cofre.atualizar(p.id, novos);
    const t = await testarConta(p.id);
    if (!t.ok) return paginaSimples(res, m.nome + ' conectado, mas o teste falhou', t.mensagem, false);
    paginaSimples(res, m.nome + ' conectado', 'Conta: ' + t.conta, true);
  } catch (e) {
    paginaSimples(res, 'Falha ao conectar ' + m.nome, esconder(e.message), false);
  }
});

rota('GET', '/api/clipes', () => clipes.listar().map(clipePublico));
rota('PUT', '/api/clipes/enviar', async (req, p, u) => clipePublico(await clipes.receberUpload(req, u.searchParams.get('nome'))));
rota('POST', '/api/clipes/importar', async (req) => clipePublico(clipes.importarCaminho((await corpoJson(req)).caminho)));
rota('POST', '/api/clipes/link', async (req) => { const b = await corpoJson(req); return clipePublico(clipes.importarLink(b.url, b.nome, { vertical: b.vertical !== false })); });
rota('POST', '/api/clipes/:id/preparar', async (req, p) => {
  const b = await corpoJson(req);
  if (b.formato === 'vertical-layout' && !b.layout) b.layout = lerPrefs().layoutVertical;
  return clipePublico(clipes.preparar(p.id, b));
});
rota('PATCH', '/api/clipes/:id', async (req, p) => clipePublico(clipes.renomear(p.id, (await corpoJson(req)).nome)));
rota('DELETE', '/api/clipes/:id', (req, p) => { clipes.remover(p.id); return { ok: true }; });
rota('GET', '/api/clipes/:id/avisos', (req, p) => {
  const c = clipes.obter(p.id);
  if (!c || !c.info) return {};
  return Object.fromEntries(plataformas.lista.filter((m) => m.avisos).map((m) => [m.id, m.avisos(c.info, {})]));
});
rota('GET', '/api/pc', (req, p, u) => clipes.listarPasta(u.searchParams.get('pasta')));
const capa = require('./lib/capa');
function clipePronto(id) {
  const c = clipes.obter(id);
  if (!c || c.estado !== 'pronto') throw new Error('Clipe nao esta pronto.');
  return c;
}
rota('GET', '/api/clipes/:id/capa', (req, p) => { const c = capa.ler(p.id); if (!c) return {}; delete c.arquivo; return c; });
rota('DELETE', '/api/clipes/:id/capa', (req, p) => { capa.remover(p.id); return { ok: true }; });
rota('POST', '/api/clipes/:id/capa', async (req, p) => capa.gerar(clipePronto(p.id), await corpoJson(req)));
rota('PUT', '/api/clipes/:id/capa-imagem', async (req, p, u) => capa.receberImagem(clipePronto(p.id), req, u.searchParams.get('nome')));
rota('GET', '/midia/:id/capa', (req, p, u, res) => { servirArquivo(req, res, capa.arquivo(p.id)); });
rota('GET', '/api/tiktok/criador', () => plataformas.obter('tiktok').criador(cofre.obter('tiktok'), { salvar: (c) => cofre.atualizar('tiktok', c) }));
rota('GET', '/api/twitch/clipes', (req, p, u) => twitch.listarClipes(cofre.obter('twitch'), u.searchParams.get('canal'), Number(u.searchParams.get('dias')) || 7));

rota('GET', '/midia/:id/video', (req, p, u, res) => { const c = clipes.obter(p.id); if (!c || !c.arquivo) throw new Error('Clipe nao encontrado.'); servirArquivo(req, res, c.arquivo); });
rota('GET', '/midia/:id/miniatura', (req, p, u, res) => { const c = clipes.obter(p.id); if (!c || !c.miniatura) { res.writeHead(404); return res.end(); } servirArquivo(req, res, c.miniatura); });

// Padroes do post (assinatura e hashtags). Nada secreto, fica em JSON simples.
const ARQ_PREFS = path.join(cofre.DADOS, 'preferencias.json');
const PREFS_PADRAO = {
  chamada: '💬 E você, o que faria no lugar? Comenta aí 👇\n👉 Segue @willscaff pra não perder os próximos cortes',
  assinatura: '🔴 Live todo dia — twitch.tv/willscaff',
  hashtags: '#capital #complexo #cpx #gtarp #gta #cortes #twitch #willscaff',
};
function lerPrefs() {
  try { return { ...PREFS_PADRAO, ...JSON.parse(fs.readFileSync(ARQ_PREFS, 'utf8')) }; } catch (e) { return { ...PREFS_PADRAO }; }
}
rota('GET', '/api/preferencias', () => lerPrefs());
rota('POST', '/api/preferencias', async (req) => {
  const b = await corpoJson(req);
  const novas = { ...lerPrefs() };
  for (const k of Object.keys(PREFS_PADRAO)) if (typeof b[k] === 'string') novas[k] = b[k].slice(0, 1000);
  // layout vertical (camera/jogo) salvo pelo editor de cortes
  if (b.layoutVertical && typeof b.layoutVertical === 'object') novas.layoutVertical = b.layoutVertical;
  cofre.gravarAtomico(ARQ_PREFS, JSON.stringify(novas, null, 2));
  return novas;
});

const lives = require('./lib/lives');
const metricas = require('./lib/metricas');
rota('GET', '/api/metricas', (req, p, u) => metricas.obter({ atualizar: u.searchParams.get('atualizar') === '1' }));
rota('GET', '/api/lives/:plat', (req, p) => lives.listar(p.plat));
rota('GET', '/api/lives/:plat/:id/preview', (req, p) => lives.enderecoPreview(p.plat, p.id));
rota('POST', '/api/lives/:plat/:id/cortar', async (req, p) => lives.cortar(p.plat, p.id, await corpoJson(req)));
rota('POST', '/api/twitch/clipar', () => lives.cliparAoVivo());
// Quem esta ao vivo agora (so as fontes ligadas).
rota('GET', '/api/aovivo', async () => {
  const saida = {};
  const ligadas = Object.fromEntries(plataformas.resumo(0).map((p) => [p.id, p.conectado]));
  await Promise.all(['twitch', 'kick'].filter((id) => ligadas[id]).map(async (id) => {
    const m = plataformas.obter(id);
    const ctx = { salvar: (c) => cofre.atualizar(id, c) };
    saida[id] = await m.aoVivo(cofre.obter(id), ctx).catch(() => null);
  }));
  return saida;
});
rota('GET', '/api/kick/clipes', () => plataformas.obter('kick').listarClipes(cofre.obter('kick')));
rota('GET', '/api/hls', (req, p, u, res) => lives.proxy(req, res, u.searchParams.get('u')));

const estudio = require('./lib/estudio');
rota('GET', '/api/estudio', () => estudio.listar());
rota('POST', '/api/estudio', async (req) => estudio.analisar(await corpoJson(req)));
rota('GET', '/api/estudio/:id', (req, p) => estudio.obter(p.id));
rota('PATCH', '/api/estudio/:id', async (req, p) => estudio.atualizar(p.id, await corpoJson(req)));
rota('POST', '/api/estudio/:id/thumbs', async (req, p) => estudio.refazerThumbs(p.id, await corpoJson(req)));
rota('POST', '/api/estudio/:id/montar', async (req, p) => { const r = await estudio.montar(p.id); return { job: r.job, clipe: clipePublico(r.clipe) }; });
rota('POST', '/api/estudio/:id/clipes', async (req, p) => (await estudio.virarClipes(p.id, (await corpoJson(req)).ids || [])).map(clipePublico));
rota('DELETE', '/api/estudio/:id', (req, p) => { estudio.apagar(p.id); return { ok: true }; });
rota('GET', '/midia/estudio/:id/:arquivo', (req, p, u, res) => { servirArquivo(req, res, estudio.arquivo(p.id, p.arquivo)); });

// ---------- pacote de contas (levar do PC pro Railway) ----------
const pacote = require('./lib/pacote');
const migracao = require('./lib/migracao');
// transferencia roda em segundo plano; a tela acompanha pelo GET
let envioOnline = null;
rota('POST', '/api/contas-pacote/enviar-online', async (req) => {
  acesso.exigirAdmin(req.quem);
  if (envioOnline && envioOnline.estado === 'enviando') throw new Error('Ja tem uma transferencia em andamento.');
  const b = await corpoJson(req);
  envioOnline = { estado: 'enviando', etapa: 'conferindo o codigo', progresso: 0 };
  migracao.enviar(b.destino, b.codigo, (etapa, progresso) => Object.assign(envioOnline, { etapa, progresso }))
    .then((r) => Object.assign(envioOnline, { estado: 'ok', resultado: r, etapa: null }))
    .catch((e) => Object.assign(envioOnline, { estado: 'erro', erro: esconder(e.message), etapa: null }));
  return envioOnline;
});
rota('GET', '/api/contas-pacote/enviar-online', (req) => { acesso.exigirAdmin(req.quem); return envioOnline || { estado: 'parado' }; });
rota('POST', '/api/contas-pacote/exportar', async (req, p, u, res) => {
  const texto = pacote.exportar((await corpoJson(req)).senha);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="postador-contas.json"', 'Cache-Control': 'no-store' });
  res.end(texto);
});
rota('POST', '/api/contas-pacote/importar', async (req) => {
  const b = await corpoJson(req);
  const r = pacote.importar(b.arquivo, b.senha);
  for (const plat of r.redes) if (plataformas.obter(plat)) await testarConta(plat);
  return r;
});

// ---------- acesso (usuarios, senha, aparelhos) ----------
rota('GET', '/api/acesso', (req) => acesso.resumo(req.quem));
rota('POST', '/api/acesso/minha-senha', async (req) => { acesso.trocarMinhaSenha(req.quem, await corpoJson(req)); return { ok: true }; });
rota('POST', '/api/acesso/usuarios', async (req) => { acesso.exigirAdmin(req.quem); return acesso.publico(acesso.criarUsuario(await corpoJson(req))); });
rota('PATCH', '/api/acesso/usuarios/:id', async (req, p) => acesso.atualizarUsuario(req.quem, p.id, await corpoJson(req)));
rota('DELETE', '/api/acesso/usuarios/:id', (req, p) => { acesso.removerUsuario(req.quem, p.id); return { ok: true }; });
rota('DELETE', '/api/acesso/sessoes/:id', (req, p) => { acesso.encerrarSessao(req.quem, p.id); return { ok: true }; });
rota('POST', '/api/acesso/sair-dos-outros', (req) => { acesso.sairDosOutros(req.quem); return { ok: true }; });

rota('GET', '/api/postagens', () => postagens.listar());
rota('POST', '/api/postagens', async (req) => postagens.criar(await corpoJson(req)));
rota('POST', '/api/postagens/:id/repetir/:plat', (req, p) => postagens.repetir(p.id, p.plat));
rota('DELETE', '/api/postagens/:id/rede/:plat', (req, p) => postagens.apagarNaRede(p.id, p.plat));
rota('DELETE', '/api/postagens/:id', (req, p) => { postagens.apagar(p.id); return { ok: true }; });

const servidor = http.createServer(async (req, res) => {
  // Bloqueia sites de fora tentando falar com o painel (DNS rebinding / CSRF).
  if (!ambiente.NUVEM && !HOSTS.has(req.headers.host)) { res.writeHead(403); return res.end('Host nao permitido'); }
  const u = new URL(req.url, 'http://' + req.headers.host);
  // ---------- login (PC e nuvem) ----------
  const html = (status, corpo, extra = {}) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); res.end(corpo); };
  const lerForm = async () => {
    let corpo = '';
    for await (const d of req) { corpo += d; if (corpo.length > 8000) break; }
    return Object.fromEntries(new URLSearchParams(corpo));
  };
  // painel online recebendo a transferencia do PC (autentica pelo codigo SENHA_PAINEL)
  if (u.pathname === '/api/migrar/receber' && req.method === 'POST') return migracao.receber(req, res, json);
  if (u.pathname === '/api/migrar/conferir' && req.method === 'POST') return migracao.conferir(req, res, json);
  if (u.pathname === '/api/migrar/arquivo' && req.method === 'PUT') return migracao.receberArquivo(req, res, json, u);
  if (u.pathname === '/login' || u.pathname === '/primeiro-acesso') {
    const primeiro = acesso.precisaPrimeiroAcesso();
    if (req.method === 'GET') return html(200, acesso.pagina({ primeiro }));
    if (req.method !== 'POST') return html(405, '');
    const f = await lerForm();
    if (primeiro) {
      try { const r = acesso.criarPrimeiro(req, f); return html(303, '', { 'Set-Cookie': r.cookie, Location: '/' }); } catch (e) { return html(400, acesso.pagina({ primeiro, erro: e.message })); }
    }
    const r = acesso.entrar(req, f.usuario, f.senha);
    if (r.erro) return html(401, acesso.pagina({ erro: r.erro }));
    return html(303, '', { 'Set-Cookie': r.cookie, Location: '/' });
  }
  if (u.pathname === '/sair') { acesso.sair(req); return html(303, '', { 'Set-Cookie': acesso.cookieSaida(), Location: '/login' }); }
  const quem = acesso.sessaoDe(req);
  if (!quem) {
    if (u.pathname.startsWith('/api/')) return json(res, 401, { erro: 'Entre de novo (sessao expirada).' });
    res.writeHead(303, { Location: '/login' });
    return res.end();
  }
  req.quem = quem;
  // senha provisoria: so libera o resto depois de trocar
  if (quem.usuario.trocarSenha) {
    if (u.pathname === '/trocar-senha' && req.method === 'POST') {
      const f = await lerForm();
      try { acesso.concluirTrocaObrigatoria(quem, f); return html(303, '', { Location: '/' }); } catch (e) { return html(400, acesso.pagina({ troca: true, quem, erro: e.message })); }
    }
    if (u.pathname.startsWith('/api/')) return json(res, 403, { erro: 'Troque a senha provisoria primeiro.', trocarSenha: true });
    if (u.pathname === '/' || u.pathname === '/index.html' || u.pathname === '/trocar-senha') return html(200, acesso.pagina({ troca: true, quem }));
    if (!/\.(css|js|png|svg|ico)$/.test(u.pathname)) { res.writeHead(303, { Location: '/trocar-senha' }); return res.end(); }
  }
  // contas das redes (chaves e tokens) so o administrador mexe
  const mexeEmConta = (u.pathname.startsWith('/api/contas') && req.method !== 'GET') || u.pathname.startsWith('/oauth/');
  if (mexeEmConta && quem.usuario.papel !== 'admin') {
    if (u.pathname.startsWith('/oauth/')) return html(403, acesso.pagina({ erro: 'So o administrador conecta as redes.' }));
    return json(res, 403, { erro: 'So o administrador mexe nas contas das redes.' });
  }
  for (const r of rotas) {
    if (r.metodo !== req.method) continue;
    const m = r.re.exec(u.pathname);
    if (!m) continue;
    try {
      const saida = await r.fn(req, m.groups || {}, u, res);
      if (!res.headersSent && saida !== undefined) json(res, 200, saida);
    } catch (e) {
      if (!res.headersSent) json(res, 400, { erro: esconder(e.message) });
    }
    return;
  }
  if (req.method !== 'GET') return json(res, 404, { erro: 'Rota nao encontrada.' });
  const alvo = path.normalize(path.join(PUBLICO, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname)));
  if (!alvo.startsWith(PUBLICO)) { res.writeHead(403); return res.end(); }
  servirArquivo(req, res, alvo);
});

servidor.requestTimeout = 0; // upload de video grande pode levar varios minutos
servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error('A porta ' + PORTA + ' ja esta em uso. O painel ja esta aberto? http://localhost:' + PORTA);
  else console.error(e);
  process.exit(1);
});

// Um envio que quebre de forma inesperada nao pode derrubar o painel inteiro.
process.on('uncaughtException', (e) => console.error('Erro inesperado:', esconder(e.stack || e.message)));
process.on('unhandledRejection', (e) => console.error('Erro inesperado:', esconder((e && e.stack) || e)));

acesso.garantirAdmin();
if (!acesso.podeSubir()) {
  console.error('Na nuvem o primeiro acesso precisa de um codigo: crie a variavel SENHA_PAINEL no Railway.');
  process.exit(1);
}
cofre.carregar();
clipes.limparTemporarios();
servidor.listen(PORTA, ambiente.NUVEM ? '0.0.0.0' : '127.0.0.1', () => {
  const f = midia.ferramentas();
  console.log('Postador de clipes: ' + ambiente.urlBase() + (ambiente.NUVEM ? ' (nuvem, porta ' + PORTA + ', dados em ' + ambiente.DADOS + ')' : ''));
  if (ambiente.NUVEM && !process.env.SENHA_PAINEL) console.log('CODIGO DE INSTALACAO (use no "Enviar pro painel online" do PC, ou como senha do admin no primeiro acesso): ' + ambiente.SENHA);
  if (!f.ffmpeg) console.log('ATENCAO: ffmpeg nao encontrado. Instale com: winget install Gyan.FFmpeg');
  if (!f.ytdlp) console.log('Opcional: yt-dlp nao encontrado (so faz falta pra links fora da Twitch): winget install yt-dlp.yt-dlp');
});
