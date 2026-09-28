// Estudio automatico: vigia as lives da Twitch e da Kick e, quando uma live
// termina, analisa sozinho e monta o video longo com as thumbs, pronto pra
// postar (nao posta sozinho). Tambem da pra mandar analisar todas as lives
// antigas de uma vez (so analise, sem montar, pra nao gastar horas e disco).
const fs = require('fs');
const path = require('path');
const cofre = require('./cofre');
const plataformas = require('./plataformas');
const estudio = require('./estudio');
const clipes = require('./clipes');

const ARQ = path.join(cofre.DADOS, 'automacao.json');
const INTERVALO = 15 * 60000;
const MIN_DURACAO = 20 * 60; // live curta demais nao vira video longo

let estado = null;
let rodando = false;
let timer = null;

function ler() {
  if (estado) return estado;
  try { estado = JSON.parse(fs.readFileSync(ARQ, 'utf8')); } catch (e) { estado = {}; }
  estado = { ligado: false, montarNovas: true, conteudo: 'rp', vistos: {}, fila: [], historico: [], ...estado };
  return estado;
}
function salvar() { cofre.gravarAtomico(ARQ, JSON.stringify(ler(), null, 1)); }
const chave = (plat, id) => plat + ':' + id;
const ligadas = () => Object.fromEntries(plataformas.resumo(0).map((p) => [p.id, p.conectado]));
const ctx = (plat) => ({ salvar: (c) => cofre.atualizar(plat, c) });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// lives que ja tem analise (feita na mao ou pelo automatico)
function jaAnalisadas() {
  const s = new Set(Object.keys(ler().vistos));
  for (const j of estudio.listar()) s.add(chave(j.plat, j.liveId));
  return s;
}

// lives da Kick que comecaram junto com uma da Twitch (mesma transmissao) ficam de fora
let twitchRecentes = [];
function repetidaDaTwitch(plat, l) {
  if (plat !== 'kick') return false;
  const t = new Date(l.criadoEm).getTime();
  return twitchRecentes.some((x) => Math.abs(new Date(x.criadoEm).getTime() - t) < 60 * 60000);
}

async function livesTerminadas(plat) {
  const m = plataformas.obter(plat);
  const lista = await m.listarLives(cofre.obter(plat), ctx(plat));
  // live rolando agora ainda nao terminou: a gravacao mais nova fica de fora
  const vivo = await m.aoVivo(cofre.obter(plat), ctx(plat)).catch(() => null);
  const ok = lista.filter((l, i) => !(vivo && i === 0) && l.duracao >= MIN_DURACAO);
  if (plat === 'twitch') twitchRecentes = ok;
  return ok.filter((l) => !repetidaDaTwitch(plat, l));
}

function enfileirar(plat, live, { montar }) {
  const e = ler();
  if (e.fila.some((x) => x.plat === plat && x.liveId === String(live.id))) return false;
  e.fila.push({ plat, liveId: String(live.id), titulo: live.titulo, duracao: live.duracao, criadoEm: live.criadoEm, montar: !!montar, entrouEm: new Date().toISOString() });
  return true;
}

// Novas lives (desde que o automatico foi ligado) -> analisa e monta.
async function verificar() {
  const e = ler();
  if (!e.ligado) return;
  const vistas = jaAnalisadas();
  const lig = ligadas();
  for (const plat of ['twitch', 'kick']) {
    if (!lig[plat]) continue;
    try {
      for (const l of await livesTerminadas(plat)) {
        if (vistas.has(chave(plat, l.id))) continue;
        // so o que foi gravado depois de ligar o automatico vira video montado
        const nova = !e.ligadoEm || new Date(l.criadoEm) >= new Date(e.ligadoEm) - 86400000;
        if (!nova) continue;
        if (enfileirar(plat, l, { montar: e.montarNovas })) registrar('Live nova na ' + (plat === 'twitch' ? 'Twitch' : 'Kick') + ': ' + l.titulo);
      }
    } catch (err) { registrar('Nao consegui ver as lives da ' + plat + ': ' + err.message); }
  }
  e.ultimaVerificacao = new Date().toISOString();
  salvar();
  processar();
}

// Todas as lives antigas que ainda nao tem analise (sem montar video).
async function analisarAntigas() {
  const vistas = jaAnalisadas();
  const lig = ligadas();
  let n = 0;
  for (const plat of ['twitch', 'kick']) {
    if (!lig[plat]) continue;
    for (const l of await livesTerminadas(plat)) if (!vistas.has(chave(plat, l.id)) && enfileirar(plat, l, { montar: false })) n++;
  }
  salvar();
  registrar(n + ' live(s) antiga(s) na fila pra analisar.');
  processar();
  return { enfileiradas: n };
}

function registrar(texto) {
  const e = ler();
  e.historico.unshift({ em: new Date().toISOString(), texto });
  e.historico = e.historico.slice(0, 60);
  salvar();
}

async function esperarJob(id) {
  for (;;) {
    const j = estudio.obter(id);
    if (j.estado === 'pronto' || j.estado === 'erro') return j;
    await espera(5000);
  }
}
async function esperarClipe(id) {
  for (;;) {
    const c = clipes.obter(id);
    if (!c || c.estado !== 'processando') return c;
    await espera(10000);
  }
}

// Um de cada vez: analisar e montar pesam no PC/servidor.
async function processar() {
  if (rodando) return;
  rodando = true;
  const e = ler();
  try {
    while (e.fila.length) {
      const item = e.fila[0];
      e.atual = { ...item, etapa: 'analisando', desde: new Date().toISOString() };
      salvar();
      let job;
      try {
        job = estudio.analisar({ plat: item.plat, liveId: item.liveId, titulo: item.titulo, duracao: item.duracao, conteudo: e.conteudo });
        e.atual.jobId = job.id;
        salvar();
        job = await esperarJob(job.id);
        e.vistos[chave(item.plat, item.liveId)] = job.id;
        if (job.estado === 'erro') { registrar('Falhou a análise de "' + item.titulo + '": ' + job.erro); }
        else {
          const sel = job.momentos.filter((m) => m.selecionado);
          registrar('Analisada: "' + item.titulo + '" — ' + job.momentos.length + ' momentos (' + sel.length + ' escolhidos).');
          if (item.montar && sel.length >= 3) {
            e.atual.etapa = 'montando o vídeo';
            salvar();
            const r = await estudio.montar(job.id);
            const c = await esperarClipe(r.clipe.id);
            registrar(c && c.estado === 'pronto' ? '🎬 Vídeo pronto pra postar: "' + (job.sugestao ? job.sugestao.titulo : item.titulo) + '"' : 'Falhou a montagem de "' + item.titulo + '": ' + (c ? c.erro : 'sumiu'));
          } else if (item.montar) registrar('Poucos momentos fortes em "' + item.titulo + '": não montei o vídeo (dá pra montar na mão no Estúdio).');
        }
      } catch (err) {
        registrar('Erro com "' + item.titulo + '": ' + err.message);
        e.vistos[chave(item.plat, item.liveId)] = 'erro';
      }
      e.fila.shift();
      e.atual = null;
      salvar();
    }
  } finally { rodando = false; }
}

function configurar({ ligado, montarNovas, conteudo }) {
  const e = ler();
  if (typeof ligado === 'boolean') {
    if (ligado && !e.ligado) e.ligadoEm = new Date().toISOString();
    e.ligado = ligado;
  }
  if (typeof montarNovas === 'boolean') e.montarNovas = montarNovas;
  if (conteudo === 'rp' || conteudo === 'react') e.conteudo = conteudo;
  salvar();
  if (e.ligado) verificar();
  return resumo();
}

function limparFila() { const e = ler(); e.fila = e.fila.slice(0, rodando ? 1 : 0); salvar(); return resumo(); }

function resumo() {
  const e = ler();
  return { ligado: e.ligado, montarNovas: e.montarNovas, conteudo: e.conteudo, ligadoEm: e.ligadoEm, ultimaVerificacao: e.ultimaVerificacao, fila: e.fila, atual: e.atual, historico: e.historico.slice(0, 20), rodando };
}

function iniciar() {
  const e = ler();
  // o que estava na metade quando o app fechou volta pro comeco da fila
  if (e.atual) { e.atual = null; salvar(); }
  if (timer) clearInterval(timer);
  timer = setInterval(() => { verificar().catch(() => {}); }, INTERVALO);
  setTimeout(() => { verificar().catch(() => {}); processar(); }, 20000);
}

module.exports = { iniciar, configurar, analisarAntigas, resumo, limparFila, verificar };
