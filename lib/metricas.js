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
    const [r, seg] = await Promise.all([
      comPrazo(m.metricas(cofre.obter(id), ctx, { ids }), 60000),
      m.seguidoresPorDia ? comPrazo(m.seguidoresPorDia(cofre.obter(id), ctx), 60000).catch((e) => ({ dias: [], aviso: require('./http').esconder(e.message) })) : null,
      m.mensal ? comPrazo(m.mensal(cofre.obter(id), ctx), 60000).catch(() => ({ meses: [] })) : null,
    ]).then(([a, b, c]) => { a.mensalApi = c ? c.meses : null; return [a, b]; });
    const avisos = [...(r.avisos || []), ...(seg && seg.aviso ? [seg.aviso] : [])];
    return { id, nome: m.nome, ok: true, ...r, avisos, seguidoresApi: seg ? seg.dias : null };
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

// Novos seguidores e quem saiu, por dia. Usa o que a rede informa; o que faltar
// sai da variacao diaria dos seguidores que o painel guarda (fica marcado "aprox").
function seguidoresPorDia(r, hist) {
  const datas = Object.keys(hist).sort();
  const liquido = {};
  for (let i = 1; i < datas.length; i++) {
    const a = hist[datas[i - 1]][r.id]; const b = hist[datas[i]][r.id];
    if (typeof a === 'number' && typeof b === 'number') liquido[datas[i]] = b - a;
  }
  const porDia = {};
  for (const d of r.seguidoresApi || []) porDia[d.dia] = { dia: d.dia, ganhos: d.ganhos, perdas: d.perdas, fonte: 'rede' };
  for (const [dia, l] of Object.entries(liquido)) {
    const x = porDia[dia];
    if (!x) porDia[dia] = { dia, ganhos: Math.max(0, l), perdas: Math.max(0, -l), fonte: 'aprox' };
    else if (x.perdas == null) { x.perdas = Math.max(0, (x.ganhos || 0) - l); x.fonte = 'misto'; }
  }
  for (const x of Object.values(porDia)) if (x.perdas == null) x.perdas = 0;
  const limite = new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10);
  return Object.values(porDia).filter((x) => x.dia >= limite).sort((a, b) => a.dia.localeCompare(b.dia));
}

// ---------- mensal ----------
// Views, seguidores, posts e lives mes a mes (ultimos 12 meses). Usa o que a rede
// informa por mes (YouTube Analytics); o resto soma os posts/lives pela data.
const chaveMes = (data) => String(data || '').slice(0, 7);
function ultimosMeses(n = 12) {
  const hoje = new Date();
  return [...Array(n)].map((_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - (n - 1 - i), 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  });
}
function mensal(redes, hist) {
  const meses = ultimosMeses(12);
  const porRede = {};
  for (const r of Object.values(redes)) {
    if (!r.ok) continue;
    const m = Object.fromEntries(meses.map((k) => [k, { views: 0, ganhos: 0, perdas: 0, posts: 0, lives: 0, horas: 0, minutos: 0 }]));
    const apiMes = Object.fromEntries((r.mensalApi || []).map((x) => [x.mes, x]));
    for (const k of meses) {
      if (apiMes[k]) Object.assign(m[k], { views: apiMes[k].views || 0, ganhos: apiMes[k].ganhos || 0, perdas: apiMes[k].perdas || 0, minutos: apiMes[k].minutos || 0, fonte: 'rede' });
    }
    for (const p of r.posts || []) {
      const k = chaveMes(p.data);
      if (!m[k]) continue;
      m[k].posts++;
      if (!apiMes[k]) m[k].views += Number(p.views) || 0;
    }
    for (const l of r.lives || []) {
      const k = chaveMes(l.data);
      if (!m[k]) continue;
      m[k].lives++;
      m[k].horas += (Number(l.duracao) || 0) / 3600;
      if (!apiMes[k]) m[k].views += Number(l.views) || 0;
    }
    for (const d of r.seguidoresDia || []) {
      const k = chaveMes(d.dia);
      if (m[k] && !apiMes[k]) { m[k].ganhos += d.ganhos || 0; m[k].perdas += d.perdas || 0; }
    }
    // total de seguidores no fim de cada mes (retrato diario do painel)
    const datas = Object.keys(hist).sort();
    for (const k of meses) {
      const ult = datas.filter((d) => chaveMes(d) === k && hist[d][r.id] != null).pop();
      if (ult) m[k].seguidores = hist[ult][r.id];
    }
    for (const k of meses) m[k].horas = Math.round(m[k].horas * 10) / 10;
    porRede[r.id] = m;
  }
  return { meses, porRede };
}

// ---------- dicas de crescimento ----------
// Olha os seus posts e aponta o que rendeu mais: horario, dia, tamanho, tipo de
// titulo e frequencia. Tudo a partir dos seus numeros.
const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
function mediana(a) { const o = [...a].sort((x, y) => x - y); return o.length ? (o.length % 2 ? o[(o.length - 1) / 2] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2) : 0; }
function comparar(posts, teste) {
  const sim = posts.filter(teste).map((p) => p.views); const nao = posts.filter((p) => !teste(p)).map((p) => p.views);
  if (sim.length < 3 || nao.length < 3) return null;
  const a = mediana(sim); const b = mediana(nao);
  return b ? Math.round(((a - b) / b) * 100) : null;
}
function dicas(redes, postagensApp) {
  const saida = [];
  const posts = Object.values(redes).flatMap((r) => (r.posts || []).map((p) => ({ ...p, plat: r.id }))).filter((p) => p.views != null && p.data);
  const nomes = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', x: 'X', twitch: 'Twitch', kick: 'Kick' };
  if (posts.length >= 6) {
    // horario
    const faixas = [['madrugada (0h–6h)', 0, 6], ['manhã (6h–12h)', 6, 12], ['tarde (12h–18h)', 12, 18], ['noite (18h–24h)', 18, 24]];
    const porFaixa = faixas.map(([nome, a, b]) => ({ nome, v: posts.filter((p) => { const h = new Date(p.data).getHours(); return h >= a && h < b; }).map((p) => p.views) })).filter((f) => f.v.length >= 3);
    if (porFaixa.length >= 2) {
      const melhor = porFaixa.sort((x, y) => mediana(y.v) - mediana(x.v))[0];
      saida.push({ icone: '⏰', titulo: 'Melhor horário pra postar: ' + melhor.nome, texto: 'Seus posts nessa faixa têm em média ' + Math.round(mediana(melhor.v)) + ' views, mais que nos outros horários. Agende os cortes pra sair nela.' });
    }
    const porDia = DIAS_SEMANA.map((nome, i) => ({ nome, v: posts.filter((p) => new Date(p.data).getDay() === i).map((p) => p.views) })).filter((d) => d.v.length >= 3);
    if (porDia.length >= 3) {
      const melhor = porDia.sort((x, y) => mediana(y.v) - mediana(x.v))[0];
      saida.push({ icone: '📅', titulo: 'Seu melhor dia: ' + melhor.nome, texto: 'É o dia em que seus posts mais rendem. Guarde os melhores cortes da semana pra soltar nele.' });
    }
    // titulo
    const pergunta = comparar(posts, (p) => /\?/.test(p.titulo || ''));
    if (pergunta != null && Math.abs(pergunta) >= 15) saida.push({ icone: '❓', titulo: pergunta > 0 ? 'Título com pergunta rende mais pra você' : 'Pergunta no título não está ajudando', texto: (pergunta > 0 ? '+' : '') + pergunta + '% de views (mediana) nos títulos com "?" comparado aos sem. ' + (pergunta > 0 ? 'Ex.: "ELE NÃO ESPERAVA ISSO?"' : 'Prefira afirmação forte: "ELE PERDEU TUDO".') });
    const caps = comparar(posts, (p) => { const t = (p.titulo || '').replace(/[^A-Za-zÀ-ú]/g, ''); return t.length > 5 && t === t.toUpperCase(); });
    if (caps != null && Math.abs(caps) >= 15) saida.push({ icone: '🔠', titulo: caps > 0 ? 'Título em MAIÚSCULAS está funcionando' : 'Título todo em maiúsculas está rendendo menos', texto: (caps > 0 ? '+' : '') + caps + '% de views comparado aos títulos normais.' });
    const numero = comparar(posts, (p) => /\d/.test(p.titulo || ''));
    if (numero != null && numero >= 15) saida.push({ icone: '🔢', titulo: 'Número no título dá mais clique', texto: '+' + numero + '% de views quando o título tem número ("3 FUGAS", "1 CONTRA 5").' });
    // tamanho (YouTube informa a duracao)
    const comDur = posts.filter((p) => p.duracao);
    if (comDur.length >= 6) {
      const curtos = comparar(comDur, (p) => p.duracao <= 30);
      if (curtos != null && Math.abs(curtos) >= 15) saida.push({ icone: '⏱', titulo: curtos > 0 ? 'Cortes de até 30 s rendem mais' : 'Cortes mais longos (30 s+) estão rendendo mais', texto: (curtos > 0 ? '+' : '') + curtos + '% de views. ' + (curtos > 0 ? 'Corte direto no lance, sem enrolação.' : 'Deixe a história se desenvolver um pouco mais.') });
    }
    const top = [...posts].sort((a, b) => b.views - a.views)[0];
    saida.push({ icone: '🏆', titulo: 'Seu post que mais bombou', texto: '"' + (top.titulo || 'sem título') + '" (' + nomes[top.plat] + ') com ' + top.views + ' views. Faça mais cortes nessa linha: mesmo tipo de situação, mesmo estilo de gancho.', url: top.url });
  } else {
    saida.push({ icone: '📊', titulo: 'Poste mais pra liberar as análises', texto: 'Com uns 6 posts com views eu começo a mostrar o melhor horário, o melhor dia e que tipo de título rende mais pra você.' });
  }
  // frequencia por rede (posts feitos pelo app)
  const ultimo = {};
  for (const p of postagensApp) for (const [plat, d] of Object.entries(p.destinos)) if (d.estado === 'ok') ultimo[plat] = Math.max(ultimo[plat] || 0, new Date(p.criadoEm).getTime());
  const paradas = ['youtube', 'instagram', 'tiktok', 'facebook'].filter((p) => redes[p] && redes[p].ok).map((p) => ({ p, dias: ultimo[p] ? Math.floor((Date.now() - ultimo[p]) / 86400000) : null })).filter((x) => x.dias == null || x.dias >= 2);
  if (paradas.length) saida.push({ icone: '🔁', titulo: 'Constância: redes paradas', texto: paradas.map((x) => nomes[x.p] + (x.dias == null ? ' (sem post pelo app ainda)' : ' (' + x.dias + ' dias sem post)')).join(', ') + '. O algoritmo premia quem posta todo dia: 1 a 3 cortes por dia em cada rede.' });
  const semana = postagensApp.filter((p) => Date.now() - new Date(p.criadoEm).getTime() < 7 * 86400000).length;
  saida.push({ icone: '🎯', titulo: 'Meta da semana: ' + semana + ' de 14 postagens', texto: 'Mire em 2 cortes por dia. Cada live rende vários: use Lives → Abrir e cortar e o Estúdio pra tirar os melhores lances.' });
  return saida;
}

async function coletar() {
  const resumo = Object.fromEntries(plataformas.resumo(0).map((p) => [p.id, p]));
  const alvos = ORDEM.filter((id) => resumo[id] && resumo[id].conectado && plataformas.obter(id).metricas);
  const lista = await Promise.all(alvos.map(coletarRede));
  const redes = Object.fromEntries(lista.map((r) => [r.id, r]));
  const historico = guardarHistorico(redes);
  for (const r of Object.values(redes)) if (r.ok) { r.seguidoresDia = seguidoresPorDia(r, historico); delete r.seguidoresApi; }
  const porMes = mensal(redes, historico);
  for (const r of Object.values(redes)) delete r.mensalApi;
  const crescimento = dicas(redes, postagens.listar());
  cache = { em: new Date().toISOString(), redes, clipes: porClipe(redes), historico, mensal: porMes, crescimento, naoConectadas: ORDEM.filter((id) => !alvos.includes(id)) };
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
