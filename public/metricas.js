'use strict';
// Aba Métricas: visão somando todas as redes ou uma rede por vez.

const met = { dados: null, rede: 'todas', ordem: 'recentes' };
const CORES = { youtube: '#ff2e4d', instagram: '#e1306c', tiktok: '#14c7cf', facebook: '#1877f2', x: '#8b98a5', twitch: '#9146ff', kick: '#3fd21a' };
const ROTULOS = {
  seguidores: 'Seguidores', views: 'Views do canal', videos: 'Posts/vídeos', curtidas: 'Curtidas', seguindo: 'Seguindo',
  lives: 'Lives gravadas', viewsLives: 'Views nas lives', curtidasPagina: 'Curtidas da página',
};

const num = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('pt-BR'));
const compacto = (n) => (n == null ? '—' : Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n));

async function carregarMetricas(atualizar) {
  const alvo = $('#metricasConteudo');
  if (atualizar || !met.dados) alvo.innerHTML = '<div class="vazio"><i class="giro"></i>Buscando os números de cada rede… (pode levar uns segundos)</div>';
  const b = $('#metricasAtualizar');
  b.disabled = true;
  try {
    met.dados = await api('GET', '/api/metricas' + (atualizar ? '?atualizar=1' : ''));
    desenharMetricas();
    // cache velho: o servidor já está buscando de novo; recarrega quando terminar
    if (met.dados.atualizando) setTimeout(() => carregarMetricas(false), 8000);
  } catch (e) { alvo.innerHTML = `<div class="vazio erro">${esc(e.message)}</div>`; }
  b.disabled = false;
}

// Quanto os seguidores mudaram desde N dias atrás (pelo retrato diário).
function variacao(plat, dias) {
  const h = met.dados.historico || {};
  const datas = Object.keys(h).sort();
  if (!datas.length) return null;
  const hoje = h[datas[datas.length - 1]][plat];
  const limite = new Date(Date.now() - dias * 86400000).toLocaleDateString('sv-SE');
  const antes = datas.filter((d) => d <= limite && h[d][plat] != null).pop();
  if (hoje == null || !antes) return null;
  return hoje - h[antes][plat];
}

function serie(plat) {
  const h = met.dados.historico || {};
  return Object.keys(h).sort().filter((d) => h[d][plat] != null).map((d) => ({ d, v: h[d][plat] }));
}

function sparkline(pontos, cor) {
  if (pontos.length < 2) return '<div class="spark vazio-spark">o gráfico aparece a partir do 2º dia</div>';
  const vs = pontos.map((p) => p.v);
  const min = Math.min(...vs); const max = Math.max(...vs);
  const W = 160; const H = 38;
  const xy = pontos.map((p, i) => [(i / (pontos.length - 1)) * W, H - 3 - ((p.v - min) / (max - min || 1)) * (H - 6)]);
  const linha = xy.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${linha} L${W} ${H} L0 ${H}Z" fill="${cor}" opacity=".12"/><path d="${linha}" fill="none" stroke="${cor}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

function delta(v) {
  if (v == null) return '';
  const cls = v > 0 ? 'sobe' : v < 0 ? 'desce' : '';
  return `<span class="delta ${cls}">${v > 0 ? '▲ +' : v < 0 ? '▼ ' : ''}${num(v)} em 7 dias</span>`;
}

function desenharAbasRede() {
  const redes = met.dados.redes || {};
  const ids = Object.keys(redes);
  $('#metricasRede').innerHTML = `<button data-rede="todas" class="${met.rede === 'todas' ? 'ativa' : ''}">Todas</button>` +
    ids.map((id) => `<button data-rede="${id}" class="${met.rede === id ? 'ativa' : ''}"><i class="bolinha-rede" style="background:${CORES[id]}"></i>${esc(redes[id].nome)}</button>`).join('');
  $('#metricasQuando').textContent = met.dados.em ? 'Atualizado ' + quando(met.dados.em) + (met.dados.atualizando ? ' · buscando de novo…' : '') : '';
}

function desenharMetricas() {
  desenharAbasRede();
  if (met.rede !== 'todas' && !met.dados.redes[met.rede]) met.rede = 'todas';
  $('#metricasConteudo').innerHTML = met.rede === 'todas' ? visaoGeral() : visaoRede(met.dados.redes[met.rede]);
}

function visaoGeral() {
  const redes = Object.values(met.dados.redes || {});
  const soma = (f) => redes.reduce((n, r) => n + (Number(f(r)) || 0), 0);
  const seguidores = soma((r) => r.ok && r.conta && r.conta.seguidores);
  const d7 = redes.reduce((n, r) => { const v = variacao(r.id, 7); return v == null ? n : (n || 0) + v; }, null);
  const clipes = met.dados.clipes || [];
  const viewsApp = clipes.reduce((n, c) => n + c.total.views, 0);
  const viewsLives = soma((r) => r.conta && r.conta.viewsLives);
  const vivos = redes.filter((r) => r.aoVivo);

  const kpis = `<div class="kpis">
    <div class="kpi destaque"><span>Seguidores somados</span><b>${num(seguidores)}</b>${delta(d7)}</div>
    <div class="kpi"><span>Views dos clipes postados pelo app</span><b>${num(viewsApp)}</b><small>${clipes.length} clipe(s)</small></div>
    <div class="kpi"><span>Views nas lives (Twitch + Kick)</span><b>${num(viewsLives)}</b><small>lives gravadas disponíveis</small></div>
    <div class="kpi ${vivos.length ? 'vivo' : ''}"><span>Ao vivo agora</span><b>${vivos.length ? vivos.map((r) => r.nome).join(' + ') : 'Offline'}</b>
      <small>${vivos.map((r) => num(r.aoVivo.espectadores) + ' assistindo').join(' · ')}</small></div>
  </div>`;

  const cards = `<div class="cards-rede">${redes.map((r) => {
    const principal = r.conta && r.conta.seguidores != null ? num(r.conta.seguidores) : '—';
    const extra = r.conta ? Object.entries(r.conta).filter(([k, v]) => k !== 'seguidores' && v != null).slice(0, 2)
      .map(([k, v]) => `<span>${ROTULOS[k] || k}: <b>${compacto(v)}</b></span>`).join('') : '';
    return `<article class="card-rede" data-rede="${r.id}" style="--cor:${CORES[r.id]}">
      <header><i class="bolinha-rede"></i><b>${esc(r.nome)}</b>${r.aoVivo ? '<span class="tag-vivo">AO VIVO</span>' : ''}</header>
      ${r.ok ? `<div class="numero-rede">${principal}<small>seguidores</small></div>${delta(variacao(r.id, 7))}
        <div class="extras-rede">${extra}</div>${sparkline(serie(r.id), CORES[r.id])}
        ${(r.avisos || []).length ? '<div class="mini-aviso">⚠ dados parciais</div>' : ''}`
        : `<div class="erro-rede">✗ ${esc(r.erro)}</div>`}
    </article>`;
  }).join('')}</div>`;

  const redesPostadas = [...new Set(clipes.flatMap((c) => Object.keys(c.redes)))];
  const tabelaClipes = clipes.length ? `<section class="bloco-met"><h2>Seus clipes nas redes</h2>
    <div class="tabela-rolagem"><table class="tabela">
      <thead><tr><th>Clipe</th>${redesPostadas.map((p) => `<th>${NOMES_PLAT[p]}</th>`).join('')}<th>Total de views</th><th>Curtidas</th></tr></thead>
      <tbody>${clipes.map((c) => `<tr><td><b>${esc(c.nome)}</b><small>${quando(c.primeiroPost)}</small></td>
        ${redesPostadas.map((p) => { const x = c.redes[p]; return `<td>${x ? (x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${num(x.views)}</a>` : num(x.views)) : '<span class="dica">—</span>'}</td>`; }).join('')}
        <td><b>${num(c.total.views)}</b></td><td>${num(c.total.curtidas)}</td></tr>`).join('')}</tbody>
    </table></div><p class="dica">"—" nas views: a rede não informa pra esse tipo de conta/permissão (veja o aviso na aba da rede).</p></section>` : '';

  const todosPosts = redes.flatMap((r) => (r.posts || []).map((p) => ({ ...p, plat: r.id }))).filter((p) => p.views != null)
    .sort((a, b) => b.views - a.views).slice(0, 10);
  const top = todosPosts.length ? `<section class="bloco-met"><h2>Top 10 posts por views (todas as redes)</h2>
    <ol class="top-posts">${todosPosts.map((p) => `<li><i class="bolinha-rede" style="background:${CORES[p.plat]}"></i>
      <a href="${esc(p.url || '#')}" target="_blank" rel="noopener">${esc(p.titulo || '(sem título)')}</a>
      <span class="dica">${NOMES_PLAT[p.plat]}${p.data ? ' · ' + new Date(p.data).toLocaleDateString('pt-BR') : ''}</span><b>${num(p.views)}</b></li>`).join('')}</ol></section>` : '';

  const faltam = (met.dados.naoConectadas || []).length ? `<p class="dica">Sem dados de: ${met.dados.naoConectadas.map((p) => NOMES_PLAT[p]).join(', ')} (não conectadas).</p>` : '';
  return kpis + cards + tabelaClipes + top + faltam;
}

function visaoRede(r) {
  if (!r.ok) return `<div class="vazio erro">✗ ${esc(r.erro)}<br><button class="mini" onclick="irPara('contas')">Ver em Contas</button></div>`;
  const kpis = `<div class="kpis">${Object.entries(r.conta || {}).filter(([, v]) => v != null).map(([k, v], i) =>
    `<div class="kpi ${i === 0 ? 'destaque' : ''}" style="--cor:${CORES[r.id]}"><span>${ROTULOS[k] || k}</span><b>${num(v)}</b>${k === 'seguidores' ? delta(variacao(r.id, 7)) : ''}</div>`).join('')}</div>`;
  const avisos = (r.avisos || []).map((a) => `<div class="aviso-plat">⚠ ${esc(a)}</div>`).join('');
  const vivo = r.aoVivo ? `<div class="faixa-ao-vivo"><div><i class="ponto-vivo"></i><b>Ao vivo</b> — ${esc(r.aoVivo.titulo || '')} <span class="dica">${num(r.aoVivo.espectadores)} assistindo</span></div></div>` : '';
  const grafico = serie(r.id).length > 1 ? `<section class="bloco-met"><h2>Seguidores por dia</h2>${sparkline(serie(r.id), CORES[r.id]).replace('class="spark"', 'class="spark grande"')}</section>` : '';

  const lista = [...(r.posts || [])].sort(met.ordem === 'views' ? (a, b) => (b.views || 0) - (a.views || 0) : (a, b) => String(b.data).localeCompare(String(a.data)));
  const temCol = (k) => lista.some((p) => p[k] != null);
  const cols = ['views', 'curtidas', 'comentarios', 'compartilhamentos'].filter(temCol);
  const nomesCol = { views: 'Views', curtidas: 'Curtidas', comentarios: 'Comentários', compartilhamentos: 'Compart.' };
  const posts = lista.length ? `<section class="bloco-met"><div class="cabecalho-secao"><h2>${r.id === 'twitch' || r.id === 'kick' ? 'Clipes do canal' : 'Posts recentes'}</h2>
      <select id="metOrdem" class="mini-select"><option value="recentes" ${met.ordem === 'recentes' ? 'selected' : ''}>Mais recentes</option><option value="views" ${met.ordem === 'views' ? 'selected' : ''}>Mais vistos</option></select></div>
    <div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Post</th><th>Data</th>${cols.map((c) => `<th>${nomesCol[c]}</th>`).join('')}</tr></thead>
    <tbody>${lista.map((p) => `<tr><td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.titulo || '(sem título)')}</a>` : esc(p.titulo || '(sem título)')}${p.privado ? ' <span class="tag-mini">privado</span>' : ''}</td>
      <td>${p.data ? new Date(p.data).toLocaleDateString('pt-BR') : ''}</td>${cols.map((c) => `<td>${num(p[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`
    : (r.id === 'twitch' || r.id === 'kick' ? '' : '<div class="vazio">Sem posts pra mostrar.</div>');

  const livesT = (r.lives || []).length ? `<section class="bloco-met"><h2>Lives</h2><div class="tabela-rolagem"><table class="tabela">
    <thead><tr><th>Live</th><th>Data</th><th>Duração</th><th>Views</th><th></th></tr></thead>
    <tbody>${r.lives.map((l, i) => `<tr><td><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.titulo || 'Live')}</a></td><td>${quando(l.data)}</td>
      <td>${hms(l.duracao)}</td><td>${num(l.views)}</td><td><button class="mini sec" data-cortar-live="${i}">✂ Cortar</button></td></tr>`).join('')}</tbody></table></div></section>` : '';
  return vivo + kpis + avisos + grafico + livesT + posts;
}

$('#metricasRede').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rede]');
  if (!b) return;
  met.rede = b.dataset.rede;
  desenharMetricas();
});
$('#metricasConteudo').addEventListener('click', (e) => {
  const card = e.target.closest('.card-rede');
  if (card && !e.target.closest('a')) { met.rede = card.dataset.rede; desenharMetricas(); return; }
  const cortar = e.target.closest('[data-cortar-live]');
  if (cortar) {
    const l = met.dados.redes[met.rede].lives[Number(cortar.dataset.cortarLive)];
    abrirLive(met.rede, { id: l.id, titulo: l.titulo, criadoEm: l.data, duracao: l.duracao, views: l.views, url: l.url });
  }
});
$('#metricasConteudo').addEventListener('change', (e) => {
  if (e.target.id === 'metOrdem') { met.ordem = e.target.value; desenharMetricas(); }
});
$('#metricasAtualizar').addEventListener('click', () => carregarMetricas(true));

aoAbrirAba.metricas = () => carregarMetricas(false);
