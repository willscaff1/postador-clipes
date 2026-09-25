'use strict';
// Aba Métricas: Visão geral, Seguidores (novos x quem saiu) e Comentários.

const met = { dados: null, rede: 'todas', visao: 'geral', ordem: 'recentes', coments: null, filtroComent: 'todas', soSemResposta: false };
const CORES = { youtube: '#ff2e4d', instagram: '#e1306c', tiktok: '#14c7cf', facebook: '#1877f2', x: '#8b98a5', twitch: '#9146ff', kick: '#3fd21a' };
const ROTULOS = {
  seguidores: 'Seguidores', views: 'Views do canal', videos: 'Posts/vídeos', curtidas: 'Curtidas', seguindo: 'Seguindo',
  lives: 'Lives gravadas', viewsLives: 'Views nas lives', curtidasPagina: 'Curtidas da página',
};

const num = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('pt-BR'));
const compacto = (n) => (n == null ? '—' : Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n));
const diaCurto = (iso) => { const [, m, d] = String(iso).slice(0, 10).split('-'); return d + '/' + m; };

async function carregarMetricas(atualizar) {
  const alvo = $('#metricasConteudo');
  if (atualizar || !met.dados) alvo.innerHTML = '<div class="vazio"><i class="giro"></i>Buscando os números de cada rede…</div>';
  const b = $('#metricasAtualizar');
  b.disabled = true;
  try {
    met.dados = await api('GET', '/api/metricas' + (atualizar ? '?atualizar=1' : ''));
    desenharMetricas();
    if (met.dados.atualizando) setTimeout(() => carregarMetricas(false), 8000);
  } catch (e) { alvo.innerHTML = `<div class="vazio erro">${esc(e.message)}</div>`; }
  b.disabled = false;
}

// ---------- gráficos (SVG) ----------
function eixoY(max, H, pad) {
  const passos = 4;
  return [...Array(passos + 1)].map((_, i) => {
    const v = Math.round((max / passos) * i);
    const y = H - pad - ((H - pad * 2) * i) / passos;
    return `<line x1="40" x2="100%" y1="${y}" y2="${y}" class="grade-linha"/><text x="34" y="${y + 4}" class="grade-texto" text-anchor="end">${compacto(v)}</text>`;
  }).join('');
}

// Barras verticais simples (ex.: views por post).
function graficoBarras(itens, { cor = 'var(--destaque)', altura = 220 } = {}) {
  if (!itens.length) return '<div class="grafico-vazio">Sem dados ainda.</div>';
  const W = 760; const H = altura; const pad = 22; const esq = 44;
  const max = Math.max(1, ...itens.map((i) => i.valor));
  const larg = (W - esq - 10) / itens.length;
  const barras = itens.map((it, i) => {
    const h = ((H - pad * 2) * it.valor) / max;
    const x = esq + i * larg + larg * 0.15;
    return `<g><rect x="${x}" y="${H - pad - h}" width="${larg * 0.7}" height="${Math.max(1, h)}" rx="4" fill="${it.cor || cor}"><title>${esc(it.titulo)}: ${num(it.valor)}</title></rect>
      ${itens.length <= 16 ? `<text x="${x + larg * 0.35}" y="${H - pad - h - 5}" class="valor-barra" text-anchor="middle">${compacto(it.valor)}</text>` : ''}</g>`;
  }).join('');
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${eixoY(max, H, pad)}${barras}</svg>`;
}

// Seguidores por dia: ganhos pra cima (verde), perdas pra baixo (vermelho).
function graficoSeguidores(dias) {
  if (!dias.length) return '';
  const W = 760; const H = 240; const esq = 44; const meio = H / 2;
  const max = Math.max(1, ...dias.map((d) => Math.max(d.ganhos || 0, d.perdas || 0)));
  const larg = (W - esq - 10) / dias.length;
  const esc2 = (v) => ((meio - 18) * v) / max;
  const barras = dias.map((d, i) => {
    const x = esq + i * larg + larg * 0.18; const w = larg * 0.64;
    const g = esc2(d.ganhos || 0); const p = esc2(d.perdas || 0);
    const rot = dias.length <= 16 || i % Math.ceil(dias.length / 10) === 0 ? `<text x="${x + w / 2}" y="${H - 2}" class="grade-texto" text-anchor="middle">${diaCurto(d.dia)}</text>` : '';
    return `<g><title>${diaCurto(d.dia)}: +${d.ganhos || 0} novos, -${d.perdas || 0} saíram${d.fonte === 'aprox' ? ' (calculado pela variação do dia)' : ''}</title>
      <rect x="${x}" y="${meio - g}" width="${w}" height="${Math.max(g ? 1 : 0, g)}" rx="3" class="barra-ganho ${d.fonte === 'aprox' ? 'aprox' : ''}"/>
      <rect x="${x}" y="${meio}" width="${w}" height="${Math.max(p ? 1 : 0, p)}" rx="3" class="barra-perda ${d.fonte === 'aprox' ? 'aprox' : ''}"/>${rot}</g>`;
  }).join('');
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <line x1="${esq}" x2="${W}" y1="${meio}" y2="${meio}" class="linha-zero"/>
    <text x="34" y="${meio - (meio - 18) + 4}" class="grade-texto" text-anchor="end">+${compacto(max)}</text>
    <text x="34" y="${meio + 4}" class="grade-texto" text-anchor="end">0</text>
    <text x="34" y="${meio + (meio - 18) + 4}" class="grade-texto" text-anchor="end">-${compacto(max)}</text>${barras}</svg>`;
}

// Total de seguidores ao longo dos dias (retrato diário do painel).
function graficoLinha(pontos, cor) {
  if (pontos.length < 2) return '';
  const W = 760; const H = 160; const esq = 44; const pad = 16;
  const vs = pontos.map((p) => p.v); const min = Math.min(...vs); const max = Math.max(...vs);
  const faixa = max - min || 1;
  const xy = pontos.map((p, i) => [esq + (i / (pontos.length - 1)) * (W - esq - 10), H - pad - ((p.v - min) / faixa) * (H - pad * 2)]);
  const linha = xy.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <text x="34" y="${pad + 4}" class="grade-texto" text-anchor="end">${compacto(max)}</text><text x="34" y="${H - pad + 4}" class="grade-texto" text-anchor="end">${compacto(min)}</text>
    <path d="${linha} L${xy[xy.length - 1][0]} ${H - pad} L${esq} ${H - pad}Z" fill="${cor}" opacity=".12"/>
    <path d="${linha}" fill="none" stroke="${cor}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
    ${xy.map((q, i) => `<circle cx="${q[0]}" cy="${q[1]}" r="3.5" fill="${cor}"><title>${diaCurto(pontos[i].d)}: ${num(pontos[i].v)}</title></circle>`).join('')}</svg>`;
}

// Barras empilhadas por mês (uma cor por rede).
const NOME_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotuloMes = (k) => NOME_MES[Number(k.slice(5, 7)) - 1] + '/' + k.slice(2, 4);
function graficoEmpilhado(meses, series, { formato = compacto } = {}) {
  const W = 760; const H = 240; const pad = 22; const esq = 44;
  const totais = meses.map((_, i) => series.reduce((n, s2) => n + (s2.valores[i] || 0), 0));
  const max = Math.max(1, ...totais);
  if (!totais.some((t) => t > 0)) return '<div class="grafico-vazio">Sem dados nesses meses ainda.</div>';
  const larg = (W - esq - 10) / meses.length;
  const barras = meses.map((k, i) => {
    let y = H - pad;
    const x = esq + i * larg + larg * 0.18; const w = larg * 0.64;
    const partes = series.map((s2) => {
      const v = s2.valores[i] || 0;
      if (!v) return '';
      const h = ((H - pad * 2) * v) / max;
      y -= h;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${s2.cor}"><title>${rotuloMes(k)} · ${s2.nome}: ${formato(v)}</title></rect>`;
    }).join('');
    return `<g>${partes}${totais[i] ? `<text x="${x + w / 2}" y="${y - 5}" class="valor-barra" text-anchor="middle">${formato(totais[i])}</text>` : ''}
      <text x="${x + w / 2}" y="${H - 4}" class="grade-texto" text-anchor="middle">${rotuloMes(k)}</text></g>`;
  }).join('');
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${eixoY(max, H, pad)}${barras}</svg>`;
}

// ---------- dados auxiliares ----------
function serie(plat) {
  const h = met.dados.historico || {};
  return Object.keys(h).sort().map((d) => ({ d, v: plat === 'todas' ? Object.values(h[d]).reduce((n, x) => n + (Number(x) || 0), 0) : h[d][plat] })).filter((p) => p.v != null);
}
function variacao(plat, dias) {
  const s = serie(plat);
  if (s.length < 2) return null;
  const limite = new Date(Date.now() - dias * 86400000).toLocaleDateString('sv-SE');
  const antes = [...s].reverse().find((p) => p.d <= limite) || s[0];
  return s[s.length - 1].v - antes.v;
}
function delta(v) {
  if (v == null) return '';
  const cls = v > 0 ? 'sobe' : v < 0 ? 'desce' : '';
  return `<span class="delta ${cls}">${v > 0 ? '▲ +' : v < 0 ? '▼ ' : ''}${num(v)}</span>`;
}
function seguidoresDe(plat) {
  const redes = Object.values(met.dados.redes || {}).filter((r) => r.ok && (plat === 'todas' || r.id === plat));
  const porDia = {};
  for (const r of redes) for (const d of r.seguidoresDia || []) {
    const x = porDia[d.dia] = porDia[d.dia] || { dia: d.dia, ganhos: 0, perdas: 0, fonte: 'rede' };
    x.ganhos += d.ganhos || 0; x.perdas += d.perdas || 0;
    if (d.fonte === 'aprox') x.fonte = x.fonte === 'rede' && x.ganhos !== d.ganhos ? 'misto' : 'aprox';
  }
  return Object.values(porDia).sort((a, b) => a.dia.localeCompare(b.dia));
}
// avisos de permissão viram uma lista só, que abre quando quiser
function pendencias() {
  const itens = [];
  for (const r of Object.values(met.dados.redes || {})) {
    if (!r.ok) itens.push({ rede: r.id, texto: r.erro });
    for (const a of r.avisos || []) itens.push({ rede: r.id, texto: a });
  }
  if (met.coments) for (const [id, v] of Object.entries(met.coments.redes || {})) if (!v.ok) itens.push({ rede: id, texto: 'Comentários: ' + v.erro });
  const vistos = new Set();
  return itens.filter((i) => { const k = i.rede + i.texto; if (vistos.has(k)) return false; vistos.add(k); return true; });
}

// ---------- telas ----------
function desenharAbasRede() {
  const redes = met.dados.redes || {};
  $('#metricasRede').innerHTML = `<button data-rede="todas" class="${met.rede === 'todas' ? 'ativa' : ''}">Todas</button>` +
    Object.keys(redes).map((id) => `<button data-rede="${id}" class="${met.rede === id ? 'ativa' : ''}"><i class="bolinha-rede" style="background:${CORES[id]}"></i>${esc(redes[id].nome)}</button>`).join('');
  $('#metricasQuando').textContent = met.dados.em ? 'Atualizado ' + quando(met.dados.em) + (met.dados.atualizando ? ' · atualizando…' : '') : '';
  $$('#metricasVisao button').forEach((b) => b.classList.toggle('ativa', b.dataset.visao === met.visao));
}

function blocoPendencias() {
  const p = pendencias();
  if (!p.length) return '';
  return `<details class="pendencias"><summary>🔧 Liberar mais dados <span class="pilula">${p.length}</span> <span class="dica">algumas redes precisam de uma permissão a mais</span></summary>
    <ul>${p.map((i) => `<li><i class="bolinha-rede" style="background:${CORES[i.rede]}"></i><b>${NOMES_PLAT[i.rede] || i.rede}:</b> ${esc(i.texto)}</li>`).join('')}</ul>
    <button class="sec mini" onclick="irPara('contas')">Abrir Contas</button></details>`;
}

function desenharMetricas() {
  desenharAbasRede();
  if (met.rede !== 'todas' && !met.dados.redes[met.rede]) met.rede = 'todas';
  const alvo = $('#metricasConteudo');
  if (met.visao === 'comentarios') { alvo.innerHTML = blocoPendencias() + '<div id="caixaComentarios"></div>'; return desenharComentarios(); }
  alvo.innerHTML = blocoPendencias() + (met.visao === 'seguidores' ? visaoSeguidores() : met.visao === 'mensal' ? visaoMensal() : met.visao === 'crescer' ? visaoCrescer()
    : met.rede === 'todas' ? visaoGeral() : visaoRede(met.dados.redes[met.rede]));
}

function kpisGerais() {
  const redes = Object.values(met.dados.redes || {});
  const seguidores = redes.reduce((n, r) => n + (Number(r.ok && r.conta && r.conta.seguidores) || 0), 0);
  const clipes = met.dados.clipes || [];
  const viewsPosts = redes.reduce((n, r) => n + (r.posts || []).reduce((m, p) => m + (Number(p.views) || 0), 0), 0);
  const viewsLives = redes.reduce((n, r) => n + (Number(r.conta && r.conta.viewsLives) || 0), 0);
  const vivos = redes.filter((r) => r.aoVivo);
  return `<div class="kpis">
    <div class="kpi destaque"><span>Seguidores somados</span><b>${num(seguidores)}</b>${delta(variacao('todas', 7))}</div>
    <div class="kpi"><span>Views dos posts recentes</span><b>${num(viewsPosts)}</b><small>somando as redes que informam</small></div>
    <div class="kpi"><span>Views nas lives</span><b>${num(viewsLives)}</b><small>Twitch + Kick</small></div>
    <div class="kpi ${vivos.length ? 'vivo' : ''}"><span>Ao vivo agora</span><b>${vivos.length ? vivos.map((r) => r.nome).join(' + ') : 'Offline'}</b>
      <small>${vivos.map((r) => num(r.aoVivo.espectadores) + ' assistindo').join(' · ') || clipes.length + ' clipe(s) postados pelo app'}</small></div>
  </div>`;
}

function visaoGeral() {
  const redes = Object.values(met.dados.redes || {});
  const cards = `<div class="cards-rede">${redes.map((r) => {
    const extra = r.conta ? Object.entries(r.conta).filter(([k, v]) => k !== 'seguidores' && v != null).slice(0, 2)
      .map(([k, v]) => `<span>${ROTULOS[k] || k}: <b>${compacto(v)}</b></span>`).join('') : '';
    return `<article class="card-rede" data-rede="${r.id}" style="--cor:${CORES[r.id]}">
      <header><i class="bolinha-rede"></i><b>${esc(r.nome)}</b>${r.aoVivo ? '<span class="tag-vivo">AO VIVO</span>' : ''}</header>
      ${r.ok ? `<div class="numero-rede">${r.conta && r.conta.seguidores != null ? num(r.conta.seguidores) : '—'}<small>seguidores</small></div>${delta(variacao(r.id, 7))}
        <div class="extras-rede">${extra}</div>` : '<div class="erro-rede">sem conexão — veja "Liberar mais dados"</div>'}
    </article>`;
  }).join('')}</div>`;
  // views dos posts mais recentes de todas as redes
  const posts = redes.flatMap((r) => (r.posts || []).map((p) => ({ ...p, plat: r.id }))).filter((p) => p.views != null && p.data)
    .sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 14).reverse();
  const top = redes.flatMap((r) => (r.posts || []).map((p) => ({ ...p, plat: r.id }))).filter((p) => p.views != null).sort((a, b) => b.views - a.views).slice(0, 8);
  const seg = seguidoresDe('todas');
  return kpisGerais() + cards + `
    <div class="met-grade">
      <section class="bloco-met"><h2>Views dos últimos posts</h2>
        ${graficoBarras(posts.map((p) => ({ valor: p.views, cor: CORES[p.plat], titulo: (NOMES_PLAT[p.plat] || '') + ' · ' + diaCurto(p.data) + ' · ' + (p.titulo || '') })))}
        <div class="legenda-graf">${[...new Set(posts.map((p) => p.plat))].map((p) => `<span><i style="background:${CORES[p]}"></i>${NOMES_PLAT[p]}</span>`).join('')}</div></section>
      <section class="bloco-met"><h2>Seguidores: novos x quem saiu</h2>
        ${seg.length ? graficoSeguidores(seg) + '<div class="legenda-graf"><span><i class="ganho"></i>novos</span><span><i class="perda"></i>deixaram de seguir</span></div>'
    : '<div class="grafico-vazio">O gráfico vai enchendo a cada dia. Com as permissões de "Liberar mais dados", YouTube, Instagram e Facebook já mostram os últimos 30 dias.</div>'}
        <button class="sec mini" data-ir-visao="seguidores">Ver por rede →</button></section>
    </div>
    ${top.length ? `<section class="bloco-met"><h2>Mais vistos</h2><ol class="top-posts">${top.map((p) => `<li><i class="bolinha-rede" style="background:${CORES[p.plat]}"></i>
      <a href="${esc(p.url || '#')}" target="_blank" rel="noopener">${esc(p.titulo || '(sem título)')}</a>
      <span class="dica">${NOMES_PLAT[p.plat]}${p.data ? ' · ' + new Date(p.data).toLocaleDateString('pt-BR') : ''}</span><b>${num(p.views)}</b></li>`).join('')}</ol></section>` : ''}`;
}

function visaoSeguidores() {
  const plat = met.rede;
  const dias = seguidoresDe(plat);
  const ganhos = dias.reduce((n, d) => n + (d.ganhos || 0), 0);
  const perdas = dias.reduce((n, d) => n + (d.perdas || 0), 0);
  const cor = CORES[plat] || '#8b5cf6';
  const s = serie(plat);
  const porRede = Object.values(met.dados.redes || {}).filter((r) => r.ok).map((r) => {
    const ds = r.seguidoresDia || [];
    return { r, g: ds.reduce((n, d) => n + (d.ganhos || 0), 0), p: ds.reduce((n, d) => n + (d.perdas || 0), 0), tem: ds.length };
  });
  return `<div class="kpis">
      <div class="kpi"><span>Novos seguidores (30 dias)</span><b class="ok-texto">+${num(ganhos)}</b></div>
      <div class="kpi"><span>Deixaram de seguir (30 dias)</span><b class="erro-texto">-${num(perdas)}</b></div>
      <div class="kpi destaque" style="--cor:${cor}"><span>Saldo</span><b>${ganhos - perdas >= 0 ? '+' : ''}${num(ganhos - perdas)}</b></div>
    </div>
    <section class="bloco-met"><h2>Por dia ${plat === 'todas' ? '(todas as redes)' : '— ' + NOMES_PLAT[plat]}</h2>
      ${dias.length ? graficoSeguidores(dias) + '<div class="legenda-graf"><span><i class="ganho"></i>novos</span><span><i class="perda"></i>deixaram de seguir</span><span><i class="aprox"></i>calculado pela variação do dia</span></div>'
    : '<div class="grafico-vazio">Ainda sem dados por dia pra essa rede. O painel guarda um retrato por dia e o gráfico vai enchendo; YouTube, Instagram e Facebook mostram 30 dias de uma vez depois de liberar a permissão (veja "Liberar mais dados").</div>'}
    </section>
    ${s.length >= 2 ? `<section class="bloco-met"><h2>Total de seguidores</h2>${graficoLinha(s, cor)}</section>` : ''}
    ${plat === 'todas' ? `<section class="bloco-met"><h2>Por rede</h2><div class="tabela-rolagem"><table class="tabela">
      <thead><tr><th>Rede</th><th>Seguidores</th><th>Novos</th><th>Saíram</th><th>Saldo</th></tr></thead>
      <tbody>${porRede.map((x) => `<tr><td><i class="bolinha-rede" style="background:${CORES[x.r.id]}"></i>${esc(x.r.nome)}</td><td>${num(x.r.conta && x.r.conta.seguidores)}</td>
        <td class="ok-texto">${x.tem ? '+' + num(x.g) : '—'}</td><td class="erro-texto">${x.tem ? '-' + num(x.p) : '—'}</td><td>${x.tem ? num(x.g - x.p) : '—'}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
}

function visaoRede(r) {
  if (!r.ok) return `<div class="vazio">Essa rede está sem conexão agora. Veja "Liberar mais dados" acima ou a aba Contas.</div>`;
  const kpis = `<div class="kpis">${Object.entries(r.conta || {}).filter(([, v]) => v != null).map(([k, v], i) =>
    `<div class="kpi ${i === 0 ? 'destaque' : ''}" style="--cor:${CORES[r.id]}"><span>${ROTULOS[k] || k}</span><b>${num(v)}</b>${k === 'seguidores' ? delta(variacao(r.id, 7)) : ''}</div>`).join('')}</div>`;
  const vivo = r.aoVivo ? `<div class="faixa-ao-vivo"><div><i class="ponto-vivo"></i><b>Ao vivo</b> — ${esc(r.aoVivo.titulo || '')} <span class="dica">${num(r.aoVivo.espectadores)} assistindo</span></div></div>` : '';
  const lista = [...(r.posts || [])].sort(met.ordem === 'views' ? (a, b) => (b.views || 0) - (a.views || 0) : (a, b) => String(b.data).localeCompare(String(a.data)));
  const recentes = [...(r.posts || [])].filter((p) => p.data && p.views != null).sort((a, b) => String(a.data).localeCompare(String(b.data))).slice(-14);
  const cols = ['views', 'curtidas', 'comentarios', 'compartilhamentos'].filter((k) => lista.some((p) => p[k] != null));
  const nomesCol = { views: 'Views', curtidas: 'Curtidas', comentarios: 'Comentários', compartilhamentos: 'Compart.' };
  const graf = recentes.length ? `<section class="bloco-met"><h2>Views por post</h2>${graficoBarras(recentes.map((p) => ({ valor: p.views, cor: CORES[r.id], titulo: diaCurto(p.data) + ' · ' + (p.titulo || '') })))}</section>` : '';
  const posts = lista.length ? `<section class="bloco-met"><div class="cabecalho-secao"><h2>${r.id === 'twitch' || r.id === 'kick' ? 'Clipes do canal' : 'Posts recentes'}</h2>
      <select id="metOrdem" class="mini-select"><option value="recentes" ${met.ordem === 'recentes' ? 'selected' : ''}>Mais recentes</option><option value="views" ${met.ordem === 'views' ? 'selected' : ''}>Mais vistos</option></select></div>
    <div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Post</th><th>Data</th>${cols.map((c) => `<th>${nomesCol[c]}</th>`).join('')}</tr></thead>
    <tbody>${lista.map((p) => `<tr><td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.titulo || '(sem título)')}</a>` : esc(p.titulo || '(sem título)')}${p.privado ? ' <span class="tag-mini">privado</span>' : ''}</td>
      <td>${p.data ? new Date(p.data).toLocaleDateString('pt-BR') : ''}</td>${cols.map((c) => `<td>${num(p[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>` : '';
  const livesT = (r.lives || []).length ? `<section class="bloco-met"><h2>Lives</h2>
    ${graficoBarras([...r.lives].reverse().slice(-14).map((l) => ({ valor: l.views || 0, cor: CORES[r.id], titulo: diaCurto(l.data) + ' · ' + (l.titulo || '') })))}
    <div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Live</th><th>Data</th><th>Duração</th><th>Views</th><th></th></tr></thead>
    <tbody>${r.lives.map((l, i) => `<tr><td><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.titulo || 'Live')}</a></td><td>${quando(l.data)}</td>
      <td>${hms(l.duracao)}</td><td>${num(l.views)}</td><td><button class="mini sec" data-cortar-live="${i}">✂ Cortar</button></td></tr>`).join('')}</tbody></table></div></section>` : '';
  return vivo + kpis + graf + livesT + posts;
}

// ---------- mensal ----------
function visaoMensal() {
  const m = met.dados.mensal;
  if (!m) return '<div class="vazio">Clique em "Atualizar agora" pra montar os meses.</div>';
  const ids = Object.keys(m.porRede).filter((id) => met.rede === 'todas' || id === met.rede);
  const serieDe = (campo) => ids.map((id) => ({ nome: NOMES_PLAT[id], cor: CORES[id], valores: m.meses.map((k) => (m.porRede[id][k] || {})[campo] || 0) })).filter((x) => x.valores.some((v) => v));
  const legenda = (series) => `<div class="legenda-graf">${series.map((x) => `<span><i style="background:${x.cor}"></i>${x.nome}</span>`).join('')}</div>`;
  const bloco = (titulo, campo, nota, formato) => { const sr = serieDe(campo); return `<section class="bloco-met"><h2>${titulo}</h2>${graficoEmpilhado(m.meses, sr, { formato })}${legenda(sr)}${nota ? `<p class="dica">${nota}</p>` : ''}</section>`; };
  const este = m.meses[m.meses.length - 1]; const ant = m.meses[m.meses.length - 2];
  const soma = (k, c) => ids.reduce((n, id) => n + ((m.porRede[id][k] || {})[c] || 0), 0);
  const comp = (c) => { const a = soma(este, c); const b = soma(ant, c); return b ? Math.round(((a - b) / b) * 100) : null; };
  const kpi = (rot, c, fmt = num) => { const v = comp(c); return `<div class="kpi"><span>${rot} em ${rotuloMes(este)}</span><b>${fmt(soma(este, c))}</b>${v == null ? '<small>sem mês anterior pra comparar</small>' : `<span class="delta ${v > 0 ? 'sobe' : v < 0 ? 'desce' : ''}">${v > 0 ? '▲ +' : v < 0 ? '▼ ' : ''}${v}% vs ${rotuloMes(ant)}</span>`}</div>`; };
  return `<div class="kpis">${kpi('Views', 'views')}${kpi('Novos seguidores', 'ganhos')}${kpi('Posts', 'posts')}${kpi('Horas de live', 'horas', (v) => num(Math.round(v)))}</div>
    <div class="met-grade">
      ${bloco('Views por mês', 'views', 'YouTube: views do canal no mês (com a permissão do Analytics). Outras redes: soma das views dos posts e lives publicados no mês.')}
      ${bloco('Novos seguidores por mês', 'ganhos', 'Vai ficando completo conforme as redes liberam o histórico e o painel guarda os retratos diários.')}
      ${bloco('Deixaram de seguir por mês', 'perdas')}
      ${bloco('Posts por mês', 'posts')}
      ${bloco('Lives por mês', 'lives')}
      ${bloco('Horas de live por mês', 'horas', '', (v) => num(Math.round(v)) + 'h')}
    </div>`;
}

// ---------- crescer ----------
function visaoCrescer() {
  const d = met.dados.crescimento || [];
  return `<section class="bloco-met"><h2>🚀 O que os seus números mostram</h2>
      <div class="dicas">${d.map((x) => `<article class="dica-card"><span class="dica-icone">${x.icone}</span><div><b>${esc(x.titulo)}</b><p>${esc(x.texto)}</p>${x.url ? `<a class="mini-link" href="${esc(x.url)}" target="_blank" rel="noopener">ver o post</a>` : ''}</div></article>`).join('')}</div>
    </section>
    <section class="bloco-met"><h2>✅ Checklist pra crescer mais rápido</h2>
      <ol class="checklist">
        <li><b>Gancho no 1º segundo.</b> O corte começa no auge, não na preparação. Quem passa o dedo decide em 1 s.</li>
        <li><b>Título que cria curiosidade, sem entregar o final:</b> "ELE NÃO ESPERAVA ISSO", "DEU MUITO RUIM", "1 CONTRA 5". Use as ideias de gancho na tela de Postar.</li>
        <li><b>Constância:</b> 1 a 3 cortes por dia em todas as redes. Cada live rende vários (Lives → Abrir e cortar).</li>
        <li><b>Vertical com a sua câmera</b> (layout 9:16): cara na tela segura mais gente que só o jogo.</li>
        <li><b>Legenda automática ligada:</b> muita gente assiste sem som.</li>
        <li><b>Responder comentário na primeira hora:</b> a rede entrega mais o vídeo que tem conversa (aba Comentários).</li>
        <li><b>Chamar pra live em todo post:</b> a assinatura "Live todo dia" já vai junto; fixe um comentário com o link.</li>
        <li><b>1 vídeo longo por semana no YouTube</b> (Estúdio) com thumbnail forte: é o que traz inscrito que fica.</li>
        <li><b>Repostar o que bombou</b> em outra rede ("Postar nas outras redes") e fazer continuação da mesma situação.</li>
      </ol>
    </section>`;
}

// ---------- comentários ----------
async function carregarComentarios(atualizar) {
  const alvo = $('#caixaComentarios');
  if (alvo && (!met.coments || atualizar)) alvo.innerHTML = '<div class="vazio"><i class="giro"></i>Buscando os comentários…</div>';
  try { met.coments = await api('GET', '/api/comentarios' + (atualizar ? '?atualizar=1' : '')); } catch (e) { if (alvo) alvo.innerHTML = `<div class="vazio erro">${esc(e.message)}</div>`; return; }
  if (met.visao === 'comentarios') desenharMetricas();
}

function desenharComentarios() {
  const alvo = $('#caixaComentarios');
  if (!met.coments) { carregarComentarios(false); return; }
  const c = met.coments;
  let lista = c.comentarios;
  const rede = met.rede !== 'todas' ? met.rede : met.filtroComent;
  if (rede !== 'todas') lista = lista.filter((x) => x.plat === rede);
  if (met.soSemResposta) lista = lista.filter((x) => !x.respondido);
  const acoesDe = (p) => (c.redes[p] && c.redes[p].acoes) || [];
  const semResp = c.comentarios.filter((x) => !x.respondido).length;
  alvo.innerHTML = `
    <div class="barra-coment">
      <div class="subabas" id="filtroComent">${['todas', 'youtube', 'instagram', 'facebook'].map((p) => `<button data-filtro="${p}" class="${rede === p ? 'ativa' : ''}">${p === 'todas' ? 'Todas' : NOMES_PLAT[p]}</button>`).join('')}</div>
      <label class="check"><input type="checkbox" id="soSemResposta" ${met.soSemResposta ? 'checked' : ''}> Só sem resposta <span class="pilula">${semResp}</span></label>
      <button class="sec mini" id="atualizarComent">↻ Atualizar</button>
    </div>
    ${lista.length ? `<div class="lista-coment">${lista.map((x) => {
    const acoes = acoesDe(x.plat);
    return `<article class="coment ${x.oculto ? 'oculto' : ''}" data-plat="${x.plat}" data-id="${esc(x.id)}">
        <span class="avatar-coment" style="--cor:${CORES[x.plat]}">${x.foto ? `<img src="${esc(x.foto)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : esc(String(x.autor || '?').charAt(0).toUpperCase())}</span>
        <div class="coment-corpo">
          <div class="coment-topo"><b>${esc(x.autor || 'Alguém')}</b><span class="tag-rede" style="--cor:${CORES[x.plat]}">${NOMES_PLAT[x.plat]}</span>
            <span class="dica">${x.data ? quando(x.data) : ''}${x.curtidas ? ' · ♥ ' + num(x.curtidas) : ''}</span>
            ${x.respondido ? '<span class="tag-ok">respondido</span>' : ''}${x.oculto ? '<span class="tag-mini">oculto</span>' : ''}</div>
          <p class="coment-texto">${esc(x.texto || '')}</p>
          <div class="dica coment-post">em <a href="${esc(x.url || '#')}" target="_blank" rel="noopener">${esc(x.post || 'post')}</a></div>
          ${(x.respostas || []).length ? `<div class="respostas">${x.respostas.map((r) => `<div class="${r.minha ? 'minha' : ''}"><b>${esc(r.autor || '')}</b> ${esc(r.texto || '')}</div>`).join('')}</div>` : ''}
          <div class="coment-acoes">
            ${acoes.includes('responder') ? '<button class="sec mini" data-acao-coment="abrir">↩ Responder</button>' : ''}
            ${acoes.includes('curtir') ? `<button class="sec mini ${x.curti ? 'ativa' : ''}" data-acao-coment="curtir">${x.curti ? '♥ Curtido' : '♡ Curtir'}</button>` : ''}
            ${acoes.includes('ocultar') ? `<button class="sec mini" data-acao-coment="ocultar">${x.oculto ? '👁 Mostrar' : '🙈 Ocultar'}</button>` : ''}
          </div>
          <form class="form-resposta" hidden><textarea rows="2" maxlength="2000" placeholder="Sua resposta pública…"></textarea>
            <div class="linha-capa"><button class="mini">Enviar resposta</button><button type="button" class="sec mini" data-acao-coment="fechar">Cancelar</button></div></form>
        </div>
      </article>`;
  }).join('')}</div>` : `<div class="vazio">${c.comentarios.length ? 'Nenhum comentário nesse filtro.' : 'Nenhum comentário recente encontrado nas redes conectadas.'}</div>`}
    <p class="dica">TikTok e X: ${esc(c.semSuporte.tiktok)} ${esc(c.semSuporte.x)}</p>`;
}

// ---------- eventos ----------
$('#metricasRede').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rede]');
  if (!b) return;
  met.rede = b.dataset.rede;
  desenharMetricas();
});
$('#metricasVisao').addEventListener('click', (e) => {
  const b = e.target.closest('[data-visao]');
  if (!b) return;
  met.visao = b.dataset.visao;
  desenharMetricas();
});
$('#metricasConteudo').addEventListener('click', async (e) => {
  const iv = e.target.closest('[data-ir-visao]');
  if (iv) { met.visao = iv.dataset.irVisao; return desenharMetricas(); }
  const card = e.target.closest('.card-rede');
  if (card && !e.target.closest('a')) { met.rede = card.dataset.rede; return desenharMetricas(); }
  const cortar = e.target.closest('[data-cortar-live]');
  if (cortar) {
    const l = met.dados.redes[met.rede].lives[Number(cortar.dataset.cortarLive)];
    return abrirLive(met.rede, { id: l.id, titulo: l.titulo, criadoEm: l.data, duracao: l.duracao, views: l.views, url: l.url });
  }
  const f = e.target.closest('[data-filtro]');
  if (f) { met.filtroComent = f.dataset.filtro; if (met.rede !== 'todas') met.rede = 'todas'; desenharAbasRede(); return desenharComentarios(); }
  if (e.target.closest('#atualizarComent')) return carregarComentarios(true);
  const ac = e.target.closest('[data-acao-coment]');
  if (!ac) return;
  const art = ac.closest('.coment');
  const form = $('.form-resposta', art);
  const acao = ac.dataset.acaoComent;
  if (acao === 'abrir') { form.hidden = false; $('textarea', form).focus(); return; }
  if (acao === 'fechar') { form.hidden = true; return; }
  const x = met.coments.comentarios.find((k) => k.plat === art.dataset.plat && k.id === art.dataset.id);
  ac.disabled = true;
  try {
    if (acao === 'curtir') await api('POST', `/api/comentarios/${x.plat}/${encodeURIComponent(x.id)}/curtir`, { valor: !x.curti });
    if (acao === 'ocultar') await api('POST', `/api/comentarios/${x.plat}/${encodeURIComponent(x.id)}/ocultar`, { valor: !x.oculto });
    if (acao === 'curtir') x.curti = !x.curti;
    if (acao === 'ocultar') x.oculto = !x.oculto;
    desenharComentarios();
  } catch (err) { toast(err.message, true); ac.disabled = false; }
});
$('#metricasConteudo').addEventListener('submit', async (e) => {
  const form = e.target.closest('.form-resposta');
  if (!form) return;
  e.preventDefault();
  const art = form.closest('.coment');
  const x = met.coments.comentarios.find((k) => k.plat === art.dataset.plat && k.id === art.dataset.id);
  const texto = $('textarea', form).value.trim();
  if (!texto) return;
  const b = $('button', form);
  b.disabled = true;
  try {
    await api('POST', `/api/comentarios/${x.plat}/${encodeURIComponent(x.id)}/responder`, { texto });
    x.respondido = true;
    x.respostas = [...(x.respostas || []), { autor: 'Você', texto, minha: true }];
    toast('Resposta publicada.');
    desenharComentarios();
  } catch (err) { toast(err.message, true); b.disabled = false; }
});
$('#metricasConteudo').addEventListener('change', (e) => {
  if (e.target.id === 'metOrdem') { met.ordem = e.target.value; desenharMetricas(); }
  if (e.target.id === 'soSemResposta') { met.soSemResposta = e.target.checked; desenharComentarios(); }
});
$('#metricasAtualizar').addEventListener('click', () => { if (met.visao === 'comentarios') carregarComentarios(true); else carregarMetricas(true); });

aoAbrirAba.metricas = () => carregarMetricas(false);
