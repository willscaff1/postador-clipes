// Lives gravadas da Twitch e da Kick: listar, assistir no painel e cortar um
// trecho que vira clipe na biblioteca.
//
// O navegador nao consegue tocar o HLS delas direto (CORS), entao o painel
// passa pelo /api/hls, que busca a playlist, reescreve os enderecos pra passarem
// por aqui tambem e repassa os pedacos de video.
const plataformas = require('./plataformas');
const cofre = require('./cofre');
const clipes = require('./clipes');

const FONTES = ['twitch', 'kick'];
// So repassa video desses servidores (Twitch, Kick e as CDNs deles).
const HOSTS_HLS = /(^|\.)(ttvnw\.net|twitch\.tv|jtvnw\.net|cloudfront\.net|kick\.com|live-video\.net|akamaized\.net)$/i;

function fonte(plat) {
  if (!FONTES.includes(plat)) throw new Error('Fonte de lives desconhecida: ' + plat);
  return plataformas.obter(plat);
}
const ctx = (plat) => ({ salvar: (c) => cofre.atualizar(plat, c) });

function listar(plat) {
  return fonte(plat).listarLives(cofre.obter(plat), ctx(plat));
}

function master(plat, id) {
  return plat === 'twitch' ? fonte('twitch').hlsDaLive(id) : fonte('kick').hlsDaLive(cofre.obter('kick'), id);
}

// Todas as qualidades da master playlist (1080p, 720p, ..., 160p, so audio).
async function variantes(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('A playlist da live respondeu ' + res.status + '.');
  const linhas = (await res.text()).split(/\r?\n/);
  const lista = [];
  for (let i = 0; i < linhas.length; i++) {
    const m = /^#EXT-X-STREAM-INF:(.*)$/.exec(linhas[i]);
    if (!m) continue;
    const alvo = linhas.slice(i + 1).find((l) => l && !l.startsWith('#'));
    if (!alvo) continue;
    const res2 = /RESOLUTION=(\d+)x(\d+)/.exec(m[1]);
    lista.push({
      banda: Number((/(?:^|,)BANDWIDTH=(\d+)/.exec(m[1]) || [])[1]) || 0,
      altura: res2 ? Number(res2[2]) : 0, // 0 = so audio
      url: new URL(alvo, url).href,
    });
  }
  return lista;
}

// Na master playlist, pega a variante de maior qualidade (a "source").
async function melhorVariante(url) {
  const video = (await variantes(url)).filter((v) => v.altura);
  if (!video.length) return url; // ja era a playlist de midia
  return video.sort((a, b) => b.banda - a.banda)[0].url;
}

async function enderecoPreview(plat, id) {
  return { url: '/api/hls?u=' + encodeURIComponent(await master(plat, id)) };
}

// Proxy HLS: playlists sao reescritas; pedacos de video vao direto.
async function proxy(req, res, alvo) {
  let u;
  try { u = new URL(alvo); } catch (e) { res.writeHead(400); return res.end(); }
  if (u.protocol !== 'https:' || !HOSTS_HLS.test(u.hostname)) { res.writeHead(403); return res.end('Endereco nao permitido'); }
  let r;
  try { r = await fetch(u, { signal: AbortSignal.timeout(30000) }); } catch (e) { res.writeHead(502); return res.end(); }
  const tipo = r.headers.get('content-type') || '';
  if (/mpegurl/i.test(tipo) || /\.m3u8$/i.test(u.pathname)) {
    const via = (x) => '/api/hls?u=' + encodeURIComponent(new URL(x, u).href);
    const texto = (await r.text()).split(/\r?\n/).map((l) => {
      if (!l) return l;
      if (l.startsWith('#')) return l.replace(/URI="([^"]+)"/g, (s, x) => 'URI="' + via(x) + '"');
      return via(l);
    }).join('\n');
    res.writeHead(r.status, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });
    return res.end(texto);
  }
  res.writeHead(r.status, { 'Content-Type': tipo || 'video/mp2t', 'Cache-Control': 'no-store' });
  if (!r.body) return res.end();
  for await (const pedaco of r.body) if (!res.write(pedaco)) await new Promise((ok) => res.once('drain', ok));
  res.end();
}

// Um trecho ou uma sequencia de trechos (na ordem da lista) vira um clipe so.
// Com "itens", a sequencia pode ter videos de fora (clipes da biblioteca) e transicoes.
async function cortar(plat, id, { inicio, fim, trechos, itens, transicoes, nome, formato, layout, titulo }) {
  if (Array.isArray(itens) && itens.length) return cortarSequencia(plat, id, { itens, transicoes, nome, formato, layout, titulo });
  const lista = (Array.isArray(trechos) && trechos.length ? trechos : [{ inicio, fim }])
    .map((t) => ({ inicio: Number(t.inicio), fim: Number(t.fim) }));
  if (lista.length > 30) throw new Error('No maximo 30 trechos por clipe.');
  for (const t of lista) if (!(t.inicio >= 0) || !(t.fim > t.inicio)) throw new Error('Tem trecho com inicio/fim invalido.');
  const total = lista.reduce((n, t) => n + t.fim - t.inicio, 0);
  if (total > 600) throw new Error('A sequencia passa de 10 minutos. Tire alguns trechos.');
  const url = await melhorVariante(await master(plat, id));
  const ini = lista[0].inicio;
  return clipes.importarTrecho(url, {
    trechos: lista, formato: formato || 'original', layout,
    nome: nome || (titulo ? titulo + ' (' + Math.floor(ini / 60) + 'm' + String(Math.floor(ini % 60)).padStart(2, '0') + 's)' : 'Trecho da live'),
    origem: plat,
  });
}

async function cortarSequencia(plat, id, { itens, transicoes, nome, formato, layout, titulo }) {
  if (itens.length > 40) throw new Error('No maximo 40 partes por video.');
  let urlLive = null;
  const lista = [];
  for (const it of itens) {
    const ini = Number(it.inicio); const fim = Number(it.fim);
    if (!(ini >= 0) || !(fim > ini)) throw new Error('Tem parte com inicio/fim invalido.');
    if (it.tipo === 'clipe') {
      const c = clipes.obter(it.clipeId);
      if (!c || c.estado !== 'pronto') throw new Error('Um dos videos de fora nao esta pronto.');
      lista.push({ entrada: c.arquivo, inicio: ini, fim: Math.min(fim, c.info.duracao), daLive: false, temAudio: !!c.info.codecAudio });
    } else {
      if (!urlLive) urlLive = await melhorVariante(await master(plat, id));
      lista.push({ entrada: urlLive, inicio: ini, fim, daLive: true, temAudio: true });
    }
  }
  const total = lista.reduce((n, t) => n + t.fim - t.inicio, 0);
  if (total > 1800) throw new Error('A sequencia passa de 30 minutos.');
  return clipes.importarSequencia(lista, {
    transicoes, formato: formato || 'original', layout, origem: plat,
    nome: nome || (titulo ? titulo + ' (montagem)' : 'Montagem da live'),
  });
}

async function cliparAoVivo() {
  const tw = fonte('twitch');
  const c = await tw.clipar(cofre.obter('twitch'), ctx('twitch'));
  // a Twitch leva alguns segundos pra processar o clipe antes de liberar o video
  const clipe = clipes.importarLink(c.url, null, { vertical: false, esperar: 20000 });
  return { ...c, clipeId: clipe.id };
}

module.exports = { listar, enderecoPreview, proxy, cortar, cliparAoVivo, master, variantes, melhorVariante };
