// Painel de metricas: junta seguidores, views e numeros dos posts de cada rede,
// cruza com o que o app postou (por clipe, somando as redes) e guarda um retrato
// diario dos seguidores pra mostrar o crescimento.
const fs = require('fs');
const path = require('path');
const cofre = require('./cofre');
const plataformas = require('./plataformas');
const postagens = require('./postagens');

const ORDEM = ['youtube', 'instagram', 'tiktok', 'facebook', 'x', 'twitch', 'kick'];
const ARQ = path.join(cofre.DADOS, 'metricas.json');
const HIST = path.join(cofre.DADOS, 'metricas-historico.json');
const VALIDADE = 10 * 60000;

let cache = null;
let emAndamento = null;

function lerJson(arq, padrao) { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch (e) { return padrao; } }

const comPrazo = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('demorou demais pra responder')), ms))]);

async function coletarRede(id) {
  const m = plataformas.obter(id);
  const ids = [];
  for (const p of postagens.listar()) {
    const d = p.destinos[id];
    if (d && d.estado === 'ok' && d.idExterno) ids.push(d.idExterno);
  }
  const ctx = { salvar: (c) => cofre.atualizar(id, c) };
  try {
    const r = await comPrazo(m.metricas(cofre.obter(id), ctx, { ids }), 60000);
    return { id, nome: m.nome, ok: true, ...r };
  } catch (e) {
    let erro = require('./http').esconder(e.message);
    if (/Cannot call API for app/i.test(erro)) erro = 'A Meta cortou o acesso do app a essa conta. Gere o token no Graph API Explorer de novo e salve no cartao do Facebook (aba Contas).';
    return { id, nome: m.nome, ok: false, erro };
  }
}

// Cada clipe postado pelo app, com os numeros de cada rede e o total.
function porClipe(redes) {
  const achar = (plat, idExterno) => {
    const r = redes[plat];
    return r && r.posts ? r.posts.find((x) => String(x.id) === String(idExterno)) : null;
  };
  const grupos = new Map();
  for (const p of postagens.listar()) {
    for (const [plat, d] of Object.entries(p.destinos)) {
      if (d.estado !== 'ok') continue;
      const g = grupos.get(p.clipeId) || { clipeId: p.clipeId, nome: p.clipeNome, primeiroPost: p.criadoEm, redes: {} };
      if (p.criadoEm < g.primeiroPost) g.primeiroPost = p.criadoEm;
      const num = achar(plat, d.idExterno);
      g.redes[plat] = { url: d.url, views: num ? num.views : null, curtidas: num ? num.curtidas : null, comentarios: num ? num.comentarios : null };
      grupos.set(p.clipeId, g);
    }
  }
  return [...grupos.values()].map((g) => {
    const soma = (k) => Object.values(g.redes).reduce((n, r) => n + (Number(r[k]) || 0), 0);
    return { ...g, total: { views: soma('views'), curtidas: soma('curtidas'), comentarios: soma('comentarios') } };
  }).sort((a, b) => b.primeiroPost.localeCompare(a.primeiroPost));
}

function guardarHistorico(redes) {
  const hist = lerJson(HIST, {});
  const hoje = new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD no fuso do PC
  hist[hoje] = hist[hoje] || {};
  for (const r of Object.values(redes)) if (r.ok && r.conta && typeof r.conta.seguidores === 'number') hist[hoje][r.id] = r.conta.seguidores;
  const dias = Object.keys(hist).sort().slice(-365);
  const enxuto = Object.fromEntries(dias.map((d) => [d, hist[d]]));
  cofre.gravarAtomico(HIST, JSON.stringify(enxuto));
  return enxuto;
}

async function coletar() {
  const resumo = Object.fromEntries(plataformas.resumo(0).map((p) => [p.id, p]));
  const alvos = ORDEM.filter((id) => resumo[id] && resumo[id].conectado && plataformas.obter(id).metricas);
  const lista = await Promise.all(alvos.map(coletarRede));
  const redes = Object.fromEntries(lista.map((r) => [r.id, r]));
  const historico = guardarHistorico(redes);
  cache = { em: new Date().toISOString(), redes, clipes: porClipe(redes), historico, naoConectadas: ORDEM.filter((id) => !alvos.includes(id)) };
  cofre.gravarAtomico(ARQ, JSON.stringify(cache));
  return cache;
}

async function obter({ atualizar } = {}) {
  if (!cache) cache = lerJson(ARQ, null);
  const velho = !cache || Date.now() - new Date(cache.em).getTime() > VALIDADE;
  if (atualizar || velho) {
    if (!emAndamento) emAndamento = coletar().finally(() => { emAndamento = null; });
    if (atualizar || !cache) return emAndamento;
  }
  return { ...cache, atualizando: !!emAndamento };
}

module.exports = { obter };
