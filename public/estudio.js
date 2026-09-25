'use strict';
// Aba Estúdio: analisa uma live inteira, lista os momentos fortes, monta o
// vídeo longo pro YouTube com thumbnail automática e vira clipes 9:16.

const est = { fonte: 'twitch', conteudo: 'rp', lives: {}, jobs: [], job: null, hls: null, tocarAte: null, editouTexto: false };
const TIPOS_EST = {
  tiro: ['🔫', 'Troca de tiro', '#ef4444'], fuga: ['🚔', 'Fuga / perseguição', '#3b82f6'], agito: ['🔥', 'Momento quente', '#f59e0b'],
  engracado: ['😂', 'Engraçado', '#22c55e'], conversa: ['🗣', 'Conversa importante', '#a855f7'], reacao: ['😱', 'Reação', '#ec4899'],
};
const ALVO_MIN = 20 * 60; const ALVO_MAX = 30 * 60;

// ---------- lista ----------
async function carregarEstudio() {
  try { est.jobs = await api('GET', '/api/estudio'); } catch (e) { est.jobs = []; }
  desenharJobs();
  carregarLivesEstudio();
  if (est.jobs.some((j) => ['analisando', 'gerando thumbs'].includes(j.estado))) setTimeout(() => { if (!$('#aba-estudio').hidden && !est.job) carregarEstudio(); }, 3000);
}

async function carregarLivesEstudio() {
  const alvo = $('#estudioLives');
  const p = estado.plataformas.find((x) => x.id === est.fonte);
  if (!p || !p.conectado) { alvo.innerHTML = `<p class="dica">A ${NOMES_PLAT[est.fonte]} não está ligada. <a href="#contas">Ligar em Contas</a></p>`; return; }
  if (!est.lives[est.fonte]) {
    alvo.innerHTML = '<p class="dica"><i class="giro"></i>Buscando as lives…</p>';
    try { est.lives[est.fonte] = await api('GET', '/api/lives/' + est.fonte); } catch (e) { alvo.innerHTML = `<p class="dica erro">${esc(e.message)}</p>`; return; }
  }
  const feitas = new Set(est.jobs.map((j) => j.plat + ':' + j.liveId));
  alvo.innerHTML = est.lives[est.fonte].slice(0, 15).map((l, i) => `
    <div class="item-compacto">
      ${l.miniatura ? `<img src="${esc(l.miniatura)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '<span class="img-vazia"></span>'}
      <div><b>${esc(l.titulo || 'Live')}</b><small>${quando(l.criadoEm)} · ${hms(l.duracao)} · 👁 ${numero(l.views)}</small></div>
      ${feitas.has(est.fonte + ':' + l.id) ? '<span class="tag-mini">já analisada</span>' : ''}
      <button class="mini" data-analisar="${i}">✨ Analisar</button>
    </div>`).join('') || '<p class="dica">Nenhuma live gravada.</p>';
}

function desenharJobs() {
  const ativos = est.jobs.filter((j) => ['analisando', 'gerando thumbs'].includes(j.estado)).length;
  $('#pilulaEstudio').textContent = ativos ? ativos + ' analisando' : '';
  $('#estudioJobs').innerHTML = est.jobs.length ? est.jobs.map((j) => `
    <article class="job-card" data-abrir-job="${j.id}">
      <div class="job-info"><b>${esc(j.titulo)}</b>
        <small>${NOMES_PLAT[j.plat]} · ${quando(j.criadoEm)}${j.momentos ? ' · ' + j.momentos + ' momentos' : ''}</small></div>
      ${['analisando', 'gerando thumbs'].includes(j.estado)
    ? `<div class="job-prog"><span class="dica"><i class="giro"></i>${esc(j.etapa || j.estado)}</span><div class="barra"><i style="width:${j.progresso || 2}%"></i></div></div>`
    : j.estado === 'erro' ? '<span class="status erro">falhou</span>' : `<span class="status ok">${j.clipeId ? 'vídeo montado' : 'pronto pra montar'}</span>`}
      <button class="mini perigo" data-apagar-job="${j.id}" title="Apagar análise">✕</button>
    </article>`).join('') : '<div class="vazio">Nenhuma análise ainda. Escolha uma live acima.</div>';
}

$('#estudioFonte').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fonte-estudio]');
  if (!b) return;
  est.fonte = b.dataset.fonteEstudio;
  $$('#estudioFonte button').forEach((x) => x.classList.toggle('ativa', x === b));
  carregarLivesEstudio();
});
$('#estudioConteudo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-conteudo]');
  if (!b) return;
  est.conteudo = b.dataset.conteudo;
  $$('#estudioConteudo button').forEach((x) => x.classList.toggle('ativa', x === b));
});
$('#estudioLives').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-analisar]');
  if (!b) return;
  const l = est.lives[est.fonte][Number(b.dataset.analisar)];
  b.disabled = true;
  try {
    await api('POST', '/api/estudio', { plat: est.fonte, liveId: l.id, titulo: l.titulo, duracao: l.duracao, conteudo: est.conteudo });
    toast('Analisando! Leva uns minutos (a live é ouvida inteira).');
    carregarEstudio();
  } catch (err) { toast(err.message, true); b.disabled = false; }
});
$('#estudioJobs').addEventListener('click', async (e) => {
  const ap = e.target.closest('[data-apagar-job]');
  if (ap) {
    e.stopPropagation();
    if (!confirm('Apagar essa análise? (os clipes e vídeos já montados continuam na biblioteca)')) return;
    await api('DELETE', '/api/estudio/' + ap.dataset.apagarJob).catch((err) => toast(err.message, true));
    return carregarEstudio();
  }
  const card = e.target.closest('[data-abrir-job]');
  if (card) abrirJob(card.dataset.abrirJob);
});

// ---------- análise aberta ----------
async function abrirJob(id) {
  try { est.job = await api('GET', '/api/estudio/' + id); } catch (e) { return toast(e.message, true); }
  est.editouTexto = false;
  $('#estudioLista').hidden = true;
  $('#estudioJob').hidden = false;
  desenharJob();
  if (est.job.estado === 'pronto') iniciarPreviewEstudio();
}
function fecharJob() {
  if (est.hls) { est.hls.destroy(); est.hls = null; }
  est.job = null;
  $('#estudioJob').hidden = true;
  $('#estudioLista').hidden = false;
  carregarEstudio();
}

const selecionados = () => est.job.momentos.filter((m) => m.selecionado).sort((a, b) => a.inicio - b.inicio);
const totalSel = () => selecionados().reduce((n, m) => n + m.fim - m.inicio, 0);

function desenharJob() {
  const j = est.job;
  const alvo = $('#estudioJob');
  if (['analisando', 'gerando thumbs'].includes(j.estado)) {
    alvo.innerHTML = `<button class="sec mini" id="voltarEstudio">← Voltar</button>
      <div class="vazio"><h2>${esc(j.titulo)}</h2><p><i class="giro"></i>${esc(j.etapa || j.estado)}</p>
      <div class="barra" style="max-width:420px;margin:0 auto"><i style="width:${j.progresso || 2}%"></i></div>
      <p class="dica">Pode sair desta tela; a análise continua.</p></div>`;
    setTimeout(async () => { if (est.job && est.job.id === j.id) { est.job = await api('GET', '/api/estudio/' + j.id); desenharJob(); if (est.job.estado === 'pronto') iniciarPreviewEstudio(); } }, 3000);
    return;
  }
  if (j.estado === 'erro') {
    alvo.innerHTML = `<button class="sec mini" id="voltarEstudio">← Voltar</button><div class="vazio erro">✗ ${esc(j.erro)}</div>`;
    return;
  }
  const clipe = j.clipeId && estado.clipes.find((c) => c.id === j.clipeId);
  alvo.innerHTML = `
    <div class="job-topo">
      <button class="sec mini" id="voltarEstudio">← Análises</button>
      <div><h2>${esc(j.titulo)}</h2><span class="dica">${NOMES_PLAT[j.plat]} · ${hms(j.duracao)} de live · ${j.conteudo === 'react' ? '📺 React' : '🎮 GTA RP'} · ${j.momentos.length} momentos encontrados</span></div>
    </div>
    <div class="estudio-grade">
      <div class="estudio-esq">
        <div class="bloco-met">
          <div class="grafico-live" id="graficoLive">${graficoLive()}</div>
          <div class="legenda-tipos">${Object.entries(TIPOS_EST).filter(([k]) => j.momentos.some((m) => m.tipo === k)).map(([, t]) => `<span><i style="background:${t[2]}"></i>${t[0]} ${t[1]}</span>`).join('')}</div>
        </div>
        <div class="bloco-met">
          <div class="cabecalho-secao"><h2>Momentos</h2>
            <span class="dica" id="totalMomentos"></span>
            <button class="sec mini" id="clipesTop">✂ Clipes 9:16 dos 5 melhores</button></div>
          <div id="listaMomentos" class="lista-momentos"></div>
        </div>
      </div>
      <div class="estudio-dir">
        <div class="bloco-met player-estudio"><video id="videoEstudio" controls playsinline></video><span class="dica" id="legendaPlayer">Clique em ▶ num momento pra assistir.</span></div>
        <div class="bloco-met">
          <h2>Thumbnail</h2>
          <div class="thumbs" id="thumbs">${(j.thumbs || []).map((t, i) => `
            <label class="thumb-op ${j.thumbEscolhida === t.arquivo ? 'escolhida' : ''}">
              <input type="radio" name="thumbEst" value="${esc(t.arquivo)}" ${j.thumbEscolhida === t.arquivo ? 'checked' : ''}>
              <img src="/midia/estudio/${j.id}/${esc(t.arquivo)}" alt="Thumbnail ${i + 1}">
              <span class="thumb-textos"><input data-thumb-l1="${i}" value="${esc(t.linha1)}" maxlength="24"><input data-thumb-l2="${i}" value="${esc(t.linha2)}" maxlength="24"></span>
            </label>`).join('')}</div>
          <button class="sec mini" id="refazerThumbs">↻ Refazer thumbnails com esses textos</button>
        </div>
        <div class="bloco-met">
          <h2>Título e descrição</h2>
          <label class="campo">Título <span class="contador" id="contTitulo"></span><input id="tituloEstudio" maxlength="100" value="${esc(j.sugestao ? j.sugestao.titulo : '')}"></label>
          <label class="campo">Descrição (com capítulos) <textarea id="descEstudio" rows="9">${esc(j.sugestao ? j.sugestao.descricao : '')}</textarea></label>
        </div>
        <div class="bloco-met montar-caixa">
          ${clipe ? statusMontagem(clipe) : `<button class="grande" id="montarVideo">🎬 Montar vídeo</button>
            <p class="dica">Emenda os momentos marcados na ordem da live, em 16:9 (vídeo normal do YouTube). A thumbnail escolhida vira a capa.</p>`}
        </div>
      </div>
    </div>`;
  desenharMomentos();
}

function statusMontagem(c) {
  if (c.estado === 'pronto') {
    return `<div class="montado"><b>✓ Vídeo montado</b><span class="dica">${tempo(c.info.duracao)} · ${c.info.largura}×${c.info.altura}</span>
      <button class="grande" id="postarYoutube">▶ Postar no YouTube</button>
      <button class="sec mini" id="remontar">Montar de novo</button></div>`;
  }
  if (c.estado === 'erro') return `<div class="apagar-erro">Falhou: ${esc(c.erro)}</div><button class="sec" id="remontar">Tentar de novo</button>`;
  return `<div><i class="giro"></i>${esc(c.etapa || 'montando')} ${c.progresso ? c.progresso + '%' : ''}<div class="barra"><i style="width:${c.progresso || 2}%"></i></div>
    <p class="dica">Renderizar 20–30 min em 1080p leva uns 15–30 min. Pode usar o resto do app enquanto isso.</p></div>`;
}

function graficoLive() {
  const j = est.job;
  const c = j.curva || [];
  if (!c.length) return '';
  const W = 1000; const H = 120;
  const max = Math.max(...c, 1); const min = Math.min(...c, 0);
  const y = (v) => H - 8 - ((v - min) / (max - min || 1)) * (H - 16);
  const pts = c.map((v, i) => `${((i / (c.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const blocos = j.momentos.map((m) => {
    const t = TIPOS_EST[m.tipo] || TIPOS_EST.agito;
    return `<rect data-momento="${m.id}" x="${(m.inicio / j.duracao) * W}" y="0" width="${Math.max(3, ((m.fim - m.inicio) / j.duracao) * W)}" height="${H}" fill="${t[2]}" opacity="${m.selecionado ? 0.55 : 0.15}" rx="2"><title>${t[0]} ${hms(m.inicio)}</title></rect>`;
  }).join('');
  const horas = [];
  for (let s = 3600; s < j.duracao; s += 3600) horas.push(`<line x1="${(s / j.duracao) * W}" x2="${(s / j.duracao) * W}" y1="0" y2="${H}" class="linha-hora"/><text x="${(s / j.duracao) * W + 4}" y="12" class="texto-hora">${s / 3600}h</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${blocos}${horas.join('')}<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

function desenharMomentos() {
  const j = est.job;
  const tot = totalSel();
  const ok = tot >= ALVO_MIN && tot <= ALVO_MAX;
  $('#totalMomentos').innerHTML = `<b class="${ok ? 'ok-texto' : 'alerta-texto'}">${tempo(tot)}</b> de vídeo · alvo 20–30 min`;
  $('#listaMomentos').innerHTML = [...j.momentos].sort((a, b) => a.inicio - b.inicio).map((m) => {
    const t = TIPOS_EST[m.tipo] || TIPOS_EST.agito;
    const clip = m.clipeId && estado.clipes.find((c) => c.id === m.clipeId);
    return `<div class="momento ${m.selecionado ? 'sel' : ''}" data-id="${m.id}" style="--cor:${t[2]}">
      <input type="checkbox" data-sel="${m.id}" ${m.selecionado ? 'checked' : ''} title="Entra no vídeo longo">
      <select data-tipo="${m.id}" class="tipo-select">${Object.entries(TIPOS_EST).map(([k, x]) => `<option value="${k}" ${k === m.tipo ? 'selected' : ''}>${x[0]} ${x[1]}</option>`).join('')}</select>
      <span class="momento-tempo">${hms(m.inicio)} → ${hms(m.fim)} <small>${tempo(m.fim - m.inicio)}</small></span>
      <span class="nota" title="Força do momento"><i style="width:${m.nota}%"></i></span>
      <button class="sec mini" data-ver="${m.id}" title="Assistir">▶</button>
      <button class="sec mini" data-ajustar="${m.id}" title="Abrir no editor pra ajustar">✎</button>
      ${clip ? (clip.estado === 'pronto' ? `<button class="mini" data-postar-clipe="${clip.id}">Postar clipe</button>` : `<span class="dica">${clip.estado === 'erro' ? '✗' : '<i class="giro"></i>' + (clip.progresso || 0) + '%'}</span>`)
    : `<button class="sec mini" data-clipe="${m.id}" title="Virar clipe 9:16 com a câmera">✂ 9:16</button>`}
    </div>`;
  }).join('');
}

async function salvarMomentos(mudancas) {
  const j = est.job;
  const r = await api('PATCH', '/api/estudio/' + j.id, { momentos: mudancas, manterTitulo: est.editouTexto });
  const tituloAntes = $('#tituloEstudio').value;
  est.job = r;
  $('#graficoLive').innerHTML = graficoLive();
  desenharMomentos();
  if (!est.editouTexto) {
    $('#tituloEstudio').value = r.sugestao.titulo;
    $('#descEstudio').value = r.sugestao.descricao;
  } else $('#tituloEstudio').value = tituloAntes;
}

// ---------- player ----------
async function iniciarPreviewEstudio() {
  const v = $('#videoEstudio');
  if (!v || !est.job) return;
  try {
    const { url } = await api('GET', '/api/lives/' + est.job.plat + '/' + est.job.liveId + '/preview');
    if (est.hls) est.hls.destroy();
    if (window.Hls && Hls.isSupported()) { est.hls = new Hls({ maxBufferLength: 15 }); est.hls.loadSource(url); est.hls.attachMedia(v); } else v.src = url;
    v.addEventListener('timeupdate', () => { if (est.tocarAte && v.currentTime >= est.tocarAte) { v.pause(); est.tocarAte = null; } });
  } catch (e) { $('#legendaPlayer').textContent = e.message; }
}
function verMomento(m) {
  const v = $('#videoEstudio');
  v.currentTime = m.inicio;
  est.tocarAte = m.fim;
  v.play();
  const t = TIPOS_EST[m.tipo] || TIPOS_EST.agito;
  $('#legendaPlayer').textContent = `${t[0]} ${t[1]} · ${hms(m.inicio)} → ${hms(m.fim)}`;
  $$('.momento').forEach((x) => x.classList.toggle('tocando', x.dataset.id === m.id));
}

// ---------- eventos ----------
$('#estudioJob').addEventListener('click', async (e) => {
  const j = est.job;
  const alvo = e.target;
  if (alvo.closest('#voltarEstudio')) return fecharJob();
  const bloco = alvo.closest('[data-momento]');
  if (bloco) { const m = j.momentos.find((x) => x.id === bloco.dataset.momento); if (m) verMomento(m); return; }
  const ver = alvo.closest('[data-ver]');
  if (ver) return verMomento(j.momentos.find((x) => x.id === ver.dataset.ver));
  const aj = alvo.closest('[data-ajustar]');
  if (aj) {
    const m = j.momentos.find((x) => x.id === aj.dataset.ajustar);
    const live = (est.lives[j.plat] || []).find((l) => String(l.id) === j.liveId) || { id: j.liveId, titulo: j.titulo, criadoEm: j.criadoEm, duracao: j.duracao };
    await abrirLive(j.plat, live);
    $('#corteInicio').value = hms(m.inicio);
    $('#corteFim').value = hms(m.fim);
    atualizarTrecho();
    setTimeout(() => { $('#videoLive').currentTime = m.inicio; }, 1500);
    return;
  }
  const cl = alvo.closest('[data-clipe]');
  if (cl) {
    cl.disabled = true;
    try { await api('POST', '/api/estudio/' + j.id + '/clipes', { ids: [cl.dataset.clipe] }); est.job = await api('GET', '/api/estudio/' + j.id); await carregarClipes(); desenharMomentos(); toast('Gerando o clipe 9:16.'); } catch (err) { toast(err.message, true); cl.disabled = false; }
    return;
  }
  if (alvo.closest('#clipesTop')) {
    const top = [...j.momentos].filter((m) => !m.clipeId).sort((a, b) => b.nota - a.nota).slice(0, 5).map((m) => m.id);
    if (!top.length) return toast('Os melhores já viraram clipe.');
    alvo.disabled = true;
    try { await api('POST', '/api/estudio/' + j.id + '/clipes', { ids: top }); est.job = await api('GET', '/api/estudio/' + j.id); await carregarClipes(); desenharMomentos(); toast(top.length + ' clipes 9:16 sendo gerados.'); } catch (err) { toast(err.message, true); }
    alvo.disabled = false;
    return;
  }
  const pc = alvo.closest('[data-postar-clipe]');
  if (pc) { escolherClipe(pc.dataset.postarClipe); irPara('postar'); return; }
  if (alvo.closest('#refazerThumbs')) {
    const textos = (j.thumbs || []).map((t, i) => [$(`[data-thumb-l1="${i}"]`).value.trim(), $(`[data-thumb-l2="${i}"]`).value.trim()]);
    alvo.disabled = true;
    alvo.textContent = 'Desenhando…';
    try { est.job = await api('POST', '/api/estudio/' + j.id + '/thumbs', { textos }); desenharJob(); iniciarPreviewEstudio(); } catch (err) { toast(err.message, true); alvo.disabled = false; }
    return;
  }
  if (alvo.closest('#montarVideo') || alvo.closest('#remontar')) {
    if (!selecionados().length) return toast('Marque pelo menos um momento.', true);
    await api('PATCH', '/api/estudio/' + j.id, { titulo: $('#tituloEstudio').value, descricao: $('#descEstudio').value });
    try {
      const r = await api('POST', '/api/estudio/' + j.id + '/montar');
      est.job = r.job;
      await carregarClipes();
      desenharJob();
      iniciarPreviewEstudio();
      toast('Montando o vídeo! Acompanha aqui ou na aba Clipes.');
    } catch (err) { toast(err.message, true); }
    return;
  }
  if (alvo.closest('#postarYoutube')) {
    const s = est.job.sugestao || {};
    estado.preMarcar = ['youtube'];
    escolherClipe(j.clipeId);
    irPara('postar');
    $('#titulo').value = $('#tituloEstudio') ? $('#tituloEstudio').value : s.titulo;
    $('#legenda').value = s.contexto || s.descricao || '';
    sincronizarCampos();
    toast('Confira o painel do YouTube e publique.');
  }
});
$('#estudioJob').addEventListener('change', async (e) => {
  const j = est.job;
  const sel = e.target.closest('[data-sel]');
  if (sel) return salvarMomentos([{ id: sel.dataset.sel, selecionado: sel.checked }]).catch((err) => toast(err.message, true));
  const tipo = e.target.closest('[data-tipo]');
  if (tipo) return salvarMomentos([{ id: tipo.dataset.tipo, tipo: tipo.value }]).catch((err) => toast(err.message, true));
  if (e.target.name === 'thumbEst') {
    $$('.thumb-op').forEach((x) => x.classList.toggle('escolhida', $('input', x).checked));
    est.job = await api('PATCH', '/api/estudio/' + j.id, { thumbEscolhida: e.target.value });
  }
});
$('#estudioJob').addEventListener('input', (e) => {
  if (e.target.id === 'tituloEstudio' || e.target.id === 'descEstudio') est.editouTexto = true;
  if (e.target.id === 'tituloEstudio') $('#contTitulo').textContent = e.target.value.length + '/100';
});
// acompanha a montagem e os clipes pela biblioteca
setInterval(() => {
  if (!est.job || $('#aba-estudio').hidden || est.job.estado !== 'pronto') return;
  const c = est.job.clipeId && estado.clipes.find((x) => x.id === est.job.clipeId);
  const caixa = $('.montar-caixa');
  if (c && caixa && !caixa.querySelector('#postarYoutube')) caixa.innerHTML = statusMontagem(c);
  // só redesenha enquanto algum clipe 9:16 ainda está sendo gerado (não atrapalha quem está mexendo na lista)
  const gerando = est.job.momentos.some((m) => { const x = m.clipeId && estado.clipes.find((k) => k.id === m.clipeId); return x && x.estado === 'processando'; });
  if (gerando || est.redesenharUltima) { desenharMomentos(); est.redesenharUltima = gerando; }
}, 2000);

aoAbrirAba.estudio = () => { if (!est.job) carregarEstudio(); };
