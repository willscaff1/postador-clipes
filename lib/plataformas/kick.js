// Kick como FONTE: lives gravadas (pra cortar clipes), clipes e metricas do canal.
//
// A API publica do site (kick.com/api/v2) fica atras do Cloudflare, que barra o
// fetch do Node mas deixa o curl do Windows passar. Nao precisa de chave: so o
// nome do canal.
const { spawn } = require('child_process');
const path = require('path');

const { CURL } = require('../ambiente');

function kick(caminho) {
  return new Promise((resolve, reject) => {
    const p = spawn(CURL, ['-s', '-m', '20', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', '-H', 'Accept: application/json',
      '-w', '\n%{http_code}', 'https://kick.com/api/v2' + caminho], { windowsHide: true });
    let saida = '';
    p.stdout.on('data', (d) => { saida += d; });
    p.on('error', (e) => reject(new Error('Kick: nao consegui rodar o curl (' + e.message + ')')));
    p.on('close', () => {
      const i = saida.lastIndexOf('\n');
      const status = Number(saida.slice(i + 1));
      const corpo = saida.slice(0, i);
      if (status === 404) return reject(new Error('Kick: canal nao encontrado.'));
      if (status !== 200) return reject(new Error('Kick respondeu ' + (status || 'sem resposta') + (status === 403 ? ' (bloqueio do Cloudflare; tente de novo em instantes)' : '')));
      try { resolve(JSON.parse(corpo)); } catch (e) { reject(new Error('Kick devolveu uma resposta estranha.')); }
    });
  });
}

const limparCanal = (c) => String(c || '').trim().replace(/^https?:\/\/(www\.)?kick\.com\//i, '').replace(/[/?#].*$/, '').replace(/^@/, '').toLowerCase();

function canalDe(cred) {
  const c = limparCanal(cred.canal);
  if (!c) throw new Error('Informe o seu canal da Kick na aba Contas.');
  return c;
}

async function listarLives(cred) {
  const canal = canalDe(cred);
  const lista = await kick('/channels/' + encodeURIComponent(canal) + '/videos');
  return (Array.isArray(lista) ? lista : []).map((v) => ({
    id: String(v.id), titulo: v.session_title, criadoEm: (v.start_time || v.created_at || '').replace(' ', 'T') + 'Z',
    duracao: Math.round((v.duration || 0) / 1000), views: (v.video && v.video.views) || v.views || 0,
    miniatura: v.thumbnail && v.thumbnail.src, hls: v.source,
    url: v.video && v.video.uuid ? 'https://kick.com/' + canal + '/videos/' + v.video.uuid : 'https://kick.com/' + canal,
    canal,
  }));
}

async function listarClipes(cred) {
  const canal = canalDe(cred);
  const r = await kick('/channels/' + encodeURIComponent(canal) + '/clips?sort=view&time=all');
  return (r.clips || []).map((c) => ({
    id: String(c.id), titulo: c.title, views: c.views || c.view_count || 0, criadoEm: c.created_at, duracao: c.duration,
    miniatura: c.thumbnail_url, video: c.clip_url || c.video_url, url: 'https://kick.com/' + canal + '/clips/' + c.id,
  }));
}

async function hlsDaLive(cred, id) {
  const l = (await listarLives(cred)).find((x) => x.id === String(id));
  if (!l || !l.hls) throw new Error('Essa live da Kick nao esta mais disponivel.');
  return l.hls;
}

async function aoVivo(cred) {
  const c = await kick('/channels/' + encodeURIComponent(canalDe(cred)));
  const v = c.livestream;
  return v ? { titulo: v.session_title, espectadores: v.viewer_count, desde: v.start_time && v.start_time.replace(' ', 'T') + 'Z' } : null;
}

async function metricas(cred) {
  const canal = canalDe(cred);
  const [c, lives, clipes] = await Promise.all([
    kick('/channels/' + encodeURIComponent(canal)),
    listarLives(cred).catch(() => []),
    listarClipes(cred).catch(() => []),
  ]);
  const vivo = c.livestream;
  return {
    conta: { seguidores: c.followers_count, lives: lives.length, viewsLives: lives.reduce((n, l) => n + (l.views || 0), 0) },
    aoVivo: vivo ? { titulo: vivo.session_title, espectadores: vivo.viewer_count, desde: vivo.start_time } : null,
    lives: lives.slice(0, 20).map((l) => ({ id: l.id, titulo: l.titulo, url: l.url, data: l.criadoEm, views: l.views, duracao: l.duracao })),
    posts: clipes.slice(0, 20).map((x) => ({ id: x.id, titulo: x.titulo, url: x.url, data: x.criadoEm, views: x.views, tipo: 'clipe' })),
  };
}

module.exports = {
  id: 'kick', nome: 'Kick', tipo: 'fonte', oauth: false, opcional: true,
  campos: [
    { nome: 'canal', rotulo: 'Seu canal da Kick', obrigatorio: true, ajuda: 'So o nome, ex.: willscaff' },
  ],
  passos: [
    'Nao precisa de chave: coloque o nome do canal (o que vem depois de kick.com/) e salve.',
    'Com isso aparecem as lives gravadas pra cortar clipes e as metricas do canal.',
  ],
  async testar(cred) {
    const c = await kick('/channels/' + encodeURIComponent(canalDe(cred)));
    return { conta: ((c.user && c.user.username) || c.slug) + ' (' + (c.followers_count || 0) + ' seguidores)' };
  },
  listarLives, listarClipes, hlsDaLive, aoVivo, metricas, limparCanal,
};
