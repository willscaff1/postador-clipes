'use strict';
// Aba Lives: lives gravadas e clipes da Twitch/Kick, editor pra cortar o lance
// de uma live e virar clipe, e botão de clipar a live que está rolando agora.

const lives = { fonte: 'twitch', visao: 'lives', lista: {}, clipesCanal: {}, aoVivo: {}, aberta: null, hls: null, cortes: [] };

function hms(s) {
  s = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h + ':' + String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
// aceita 1:02:03, 62:03, 3723 ou 1h2m3s
function lerTempo(t) {
  const txt = String(t || '').trim();
  if (!txt) return NaN;
  const hm = /^(?:(\d+)h)?\s*(?:(\d+)m(?:in)?)?\s*(?:(\d+(?:[.,]\d+)?)s)?$/i.exec(txt);
  if (hm && (hm[1] || hm[2] || hm[3])) return (Number(hm[1]) || 0) * 3600 + (Number(hm[2]) || 0) * 60 + (Number(String(hm[3] || 0).replace(',', '.')) || 0);
  const partes = txt.split(':').map((x) => Number(x.replace(',', '.')));
  if (partes.some((x) => Number.isNaN(x))) return NaN;
  return partes.reduce((n, x) => n * 60 + x, 0);
}
const numero = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
const fonteConectada = (plat) => { const p = estado.plataformas.find((x) => x.id === plat); return p && p.conectado; };

// ---------- lista ----------

async function carregarLives(forcar) {
  const plat = lives.fonte;
  const alvo = $('#livesConteudo');
  if (!fonteConectada(plat)) {
    alvo.innerHTML = `<div class="vazio">A ${NOMES_PLAT[plat]} ainda não está ligada. <button class="mini" onclick="irPara('contas')">Ir pra Contas</button></div>`;
    return;
  }
  verAoVivo();
  if (lives.visao === 'clipes') return carregarClipesCanal(forcar);
  if (!lives.lista[plat] || forcar) {
    alvo.innerHTML = '<div class="vazio"><i class="giro"></i>Buscando as lives…</div>';
    try { lives.lista[plat] = await api('GET', '/api/lives/' + plat); } catch (e) { alvo.innerHTML = `<div class="vazio erro">${esc(e.message)}</div>`; return; }
  }
  const l = lives.lista[plat];
  if (!l.length) { alvo.innerHTML = '<div class="vazio">Nenhuma live gravada ainda. A Twitch guarda as lives por 7 a 60 dias, dependendo da conta.</div>'; return; }
  alvo.innerHTML = `<div class="grade-lives">${l.map((v, i) => `
    <article class="card-live" data-i="${i}">
      <div class="thumb-live">${v.miniatura ? `<img src="${esc(v.miniatura)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
        <span class="dur">${hms(v.duracao)}</span></div>
      <div class="corpo">
        <b class="titulo-live">${esc(v.titulo || 'Live sem título')}</b>
        <span class="meta">${quando(v.criadoEm)} · 👁 ${numero(v.views)}</span>
        <div class="botoes">
          <button class="mini" data-abrir-live="${i}">✂ Abrir e cortar</button>
          <a class="mini-link" href="${esc(v.url)}" target="_blank" rel="noopener">ver na ${NOMES_PLAT[plat]}</a>
        </div>
      </div>
    </article>`).join('')}</div>`;
}

async function carregarClipesCanal(forcar) {
  const plat = lives.fonte;
  const alvo = $('#livesConteudo');
  if (!lives.clipesCanal[plat] || forcar) {
    alvo.innerHTML = '<div class="vazio"><i class="giro"></i>Buscando os clipes…</div>';
    try {
      if (plat === 'twitch') {
        const p = estado.plataformas.find((x) => x.id === 'twitch');
        const canal = (p.campos.find((c) => c.nome === 'canalPadrao') || {}).valor;
        lives.clipesCanal.twitch = await api('GET', '/api/twitch/clipes?canal=' + encodeURIComponent(canal) + '&dias=3650');
      } else {
        lives.clipesCanal.kick = await api('GET', '/api/kick/clipes');
      }
    } catch (e) { alvo.innerHTML = `<div class="vazio erro">${esc(e.message)}</div>`; return; }
  }
  const l = lives.clipesCanal[plat];
  if (!l.length) { alvo.innerHTML = `<div class="vazio">Nenhum clipe no canal da ${NOMES_PLAT[plat]} ainda. Crie um cortando uma live em "Lives gravadas".</div>`; return; }
  const naBiblioteca = (c) => estado.clipes.some((x) => x.link && (x.link.includes(c.slug || '###') || x.link === c.url));
  alvo.innerHTML = `<div class="grade-lives">${l.map((c, i) => `
    <article class="card-live">
      <div class="thumb-live">${c.miniatura ? `<img src="${esc(c.miniatura)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
        ${c.temVertical ? '<span class="tag">vertical pronta</span>' : ''}<span class="dur">${tempo(c.duracao)}</span></div>
      <div class="corpo">
        <b class="titulo-live">${esc(c.titulo || 'Clipe')}</b>
        <span class="meta">${c.criadoEm ? quando(c.criadoEm) + ' · ' : ''}👁 ${numero(c.views)}${c.autor ? ' · por ' + esc(c.autor) : ''}</span>
        <div class="botoes">
          ${naBiblioteca(c) ? '<span class="postado-em">✓ já está nos seus clipes</span>' : `<button class="mini" data-trazer-clipe="${i}">Trazer pra postar</button>`}
          <a class="mini-link" href="${esc(c.url)}" target="_blank" rel="noopener">ver</a>
        </div>
      </div>
    </article>`).join('')}</div>`;
}

async function verAoVivo() {
  try {
    lives.aoVivo = await api('GET', '/api/aovivo');
  } catch (e) { lives.aoVivo = {}; }
  const vivos = Object.entries(lives.aoVivo).filter(([, v]) => v);
  $('#pilulaAoVivo').textContent = vivos.length ? 'AO VIVO' : '';
  const f = $('#faixaAoVivo');
  f.hidden = !vivos.length;
  f.innerHTML = vivos.map(([plat, v]) => `<div><i class="ponto-vivo"></i><b>Ao vivo na ${NOMES_PLAT[plat]}</b> — ${esc(v.titulo || '')}
      <span class="dica">${numero(v.espectadores)} assistindo${v.desde ? ' · desde ' + new Date(v.desde).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
      ${plat === 'twitch' ? '<button class="mini" id="cliparAgora">✂ Clipar agora (últimos 30 s)</button>' : ''}</div>`).join('');
}

$('#livesFonte').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fonte-live]');
  if (!b) return;
  lives.fonte = b.dataset.fonteLive;
  $$('#livesFonte button').forEach((x) => x.classList.toggle('ativa', x === b));
  carregarLives();
});
$('#livesVisao').addEventListener('click', (e) => {
  const b = e.target.closest('[data-visao]');
  if (!b) return;
  lives.visao = b.dataset.visao;
  $$('#livesVisao button').forEach((x) => x.classList.toggle('ativa', x === b));
  carregarLives();
});
$('#livesAtualizar').addEventListener('click', () => carregarLives(true));

$('#aba-lives').addEventListener('click', async (e) => {
  const abrir = e.target.closest('[data-abrir-live]');
  if (abrir) return abrirLive(lives.fonte, lives.lista[lives.fonte][Number(abrir.dataset.abrirLive)]);
  const trazer = e.target.closest('[data-trazer-clipe]');
  if (trazer) {
    const c = lives.clipesCanal[lives.fonte][Number(trazer.dataset.trazerClipe)];
    trazer.disabled = true;
    try {
      const novo = await api('POST', '/api/clipes/link', { url: c.video && lives.fonte === 'kick' ? c.video : c.url, vertical: true, nome: c.titulo });
      estado.aguardando = novo.id;
      estado.clipeId = null;
      $('#titulo').value = '';
      irPara('postar');
      await carregarClipes();
    } catch (err) { toast(err.message, true); trazer.disabled = false; }
    return;
  }
  if (e.target.closest('#cliparAgora')) {
    const b = e.target.closest('#cliparAgora');
    b.disabled = true;
    b.textContent = 'Clipando…';
    try {
      await api('POST', '/api/twitch/clipar');
      toast('Clipe criado na Twitch! Ele entra nos seus clipes em alguns segundos.');
      await carregarClipes();
    } catch (err) { toast(err.message, true); }
    b.disabled = false;
    b.textContent = '✂ Clipar agora (últimos 30 s)';
  }
});

// ---------- editor ----------
// Carrega a live inteira; você marca início/fim, adiciona o corte na faixa de
// baixo, arrasta os cortes pra ordenar e salva tudo como um clipe só.

const video = $('#videoLive');
const ZOOM = 120; // segundos visíveis na linha do tempo de zoom
lives.seq = [];
lives.sel = null;
lives.zoomIni = 0;
let proximoCorte = 1;

async function abrirLive(plat, live) {
  lives.aberta = { plat, ...live };
  lives.cortes = [];
  lives.seq = [];
  lives.sel = null;
  lives.thumbInicio = null;
  $('#liveTitulo').textContent = live.titulo || 'Live';
  $('#liveInfo').textContent = `${NOMES_PLAT[plat]} · ${quando(live.criadoEm)} · ${hms(live.duracao)} · 👁 ${numero(live.views)}`;
  $('#corteInicio').value = '';
  $('#corteFim').value = '';
  $('#corteNome').value = live.titulo || '';
  $('#cortesFeitos').innerHTML = '';
  desenharSequencia();
  atualizarTrecho();
  carregarLayout();
  $('#dlgLive').showModal();
  try {
    const { url } = await api('GET', '/api/lives/' + plat + '/' + live.id + '/preview');
    if (lives.hls) { lives.hls.destroy(); lives.hls = null; }
    if (window.Hls && Hls.isSupported()) {
      lives.hls = new Hls({ maxBufferLength: 20, startLevel: -1 });
      lives.hls.loadSource(url);
      lives.hls.attachMedia(video);
      lives.hls.on(Hls.Events.ERROR, (ev, d) => { if (d.fatal) toast('O player da live falhou: ' + d.details, true); });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
    } else {
      toast('Não deu pra carregar o player (sem internet pro hls.js?).', true);
    }
  } catch (e) { toast(e.message, true); }
}

$('#dlgLive').addEventListener('close', () => {
  video.pause();
  $('#videoExtra').pause();
  $('#videoExtra').hidden = true;
  fecharMenus();
  if (lives.hls) { lives.hls.destroy(); lives.hls = null; }
  video.removeAttribute('src');
  video.load();
  lives.aberta = null;
  lives.tocando = null;
});

const duracaoLive = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (lives.aberta && lives.aberta.duracao) || 0);
const marcas = () => ({ ini: lerTempo($('#corteInicio').value), fim: lerTempo($('#corteFim').value) });
const pct = (t, total) => Math.max(0, Math.min(100, (t / total) * 100)) + '%';

// Foto do quadro atual (o vídeo passa pelo nosso proxy, então o canvas pode ler).
function fotoQuadro() {
  try {
    const c = document.createElement('canvas');
    c.width = 192; c.height = 108;
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  } catch (e) { return null; }
}

function atualizarTrecho() {
  const { ini, fim } = marcas();
  const total = duracaoLive();
  const marca = $('#trechoMarcado');
  const ok = ini >= 0 && fim > ini;
  if (total && ok) {
    marca.hidden = false;
    marca.style.left = pct(ini, total);
    marca.style.width = Math.max(0.3, ((fim - ini) / total) * 100) + '%';
  } else marca.hidden = true;
  const d = $('#corteDuracao');
  if (ok) {
    const dur = fim - ini;
    d.textContent = `Corte de ${tempo(dur)}` + (lives.sel != null ? ` (editando o corte #${lives.seq[lives.sel].n})` : '') + '.';
  } else if (!Number.isNaN(ini) && !Number.isNaN(fim) && fim <= ini) {
    d.textContent = 'O fim precisa ser depois do início.';
  } else {
    d.textContent = 'Pause no começo do lance e aperte "Início aqui" (I); depois no fim (O) e em "Adicionar corte" (A).';
  }
  d.classList.toggle('alerta-texto', !ok && !Number.isNaN(fim));
  $('#adicionarCorte').textContent = lives.sel != null ? '✓ Salvar alteração' : '＋ Adicionar corte';
  desenharZoom();
}

// ----- linha do tempo inteira -----
function desenharBlocos() {
  const total = duracaoLive();
  $('#blocosTrechos').innerHTML = total ? lives.seq.map((t, i) =>
    `<div class="bloco-trecho ${lives.sel === i ? 'sel' : ''}" style="left:${pct(t.inicio, total)};width:${Math.max(0.3, ((t.fim - t.inicio) / total) * 100)}%" title="#${t.n}"></div>`).join('') : '';
}
$('#linhaTempo').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const total = duracaoLive();
  if (total) video.currentTime = ((e.clientX - r.left) / r.width) * total;
});

// ----- zoom: 2 minutos em volta do ponto atual, com alças arrastáveis -----
function centralizarZoom(t) {
  const total = duracaoLive();
  lives.zoomIni = Math.max(0, Math.min(Math.max(0, total - ZOOM), t - ZOOM / 2));
}
function desenharZoom() {
  const total = duracaoLive();
  if (!total) return;
  const z0 = lives.zoomIni;
  const escala = [];
  for (let s = Math.ceil(z0 / 10) * 10; s <= z0 + ZOOM; s += 10) {
    escala.push(`<span style="left:${pct(s - z0, ZOOM)}" class="${s % 60 === 0 ? 'forte' : ''}">${s % 30 === 0 ? hms(s) : ''}</span>`);
  }
  const outros = lives.seq.map((t, i) => (i === lives.sel || t.fim < z0 || t.inicio > z0 + ZOOM) ? ''
    : `<div class="zoom-outro" style="left:${pct(t.inicio - z0, ZOOM)};width:${((Math.min(t.fim, z0 + ZOOM) - Math.max(t.inicio, z0)) / ZOOM) * 100}%">#${t.n}</div>`).join('');
  $('#zoomEscala').innerHTML = escala.join('') + outros;
  const { ini, fim } = marcas();
  const zt = $('#zoomTrecho');
  if (ini >= 0) {
    const f = fim > ini ? fim : ini;
    zt.hidden = false;
    zt.style.left = pct(ini - z0, ZOOM);
    zt.style.width = Math.max(0, ((Math.min(f, z0 + ZOOM) - Math.max(ini, z0)) / ZOOM) * 100) + '%';
    zt.classList.toggle('so-inicio', !(fim > ini));
  } else zt.hidden = true;
  $('#zoomAgulha').style.left = pct(video.currentTime - z0, ZOOM);
  desenharBlocos();
}
const tempoNoZoom = (x) => { const r = $('#zoomTempo').getBoundingClientRect(); return Math.max(0, Math.min(duracaoLive(), lives.zoomIni + ((x - r.left) / r.width) * ZOOM)); };

let arrastandoAlca = null;
$('#zoomTempo').addEventListener('pointerdown', (e) => {
  const alca = e.target.closest('[data-alca]');
  if (alca) {
    arrastandoAlca = alca.dataset.alca;
    e.currentTarget.setPointerCapture(e.pointerId);
    video.pause();
    e.preventDefault();
    return;
  }
  video.currentTime = tempoNoZoom(e.clientX);
});
$('#zoomTempo').addEventListener('pointermove', (e) => {
  if (!arrastandoAlca) return;
  const t = Math.round(tempoNoZoom(e.clientX) * 10) / 10;
  const { ini, fim } = marcas();
  if (arrastandoAlca === 'ini') { $('#corteInicio').value = hms1(Math.min(t, fim > 0 ? fim - 0.2 : t)); }
  else { $('#corteFim').value = hms1(Math.max(t, ini + 0.2)); }
  video.currentTime = t; // mostra o quadro exato de onde a alça está
  atualizarTrecho();
});
$('#zoomTempo').addEventListener('pointerup', () => {
  if (arrastandoAlca === 'ini') lives.thumbInicio = null;
  arrastandoAlca = null;
});

// tempo com décimo de segundo quando precisar (0:20:03.4)
function hms1(s) {
  const base = hms(Math.floor(s));
  const dec = Math.round((s - Math.floor(s)) * 10);
  return dec ? base + '.' + dec : base;
}

// ----- player -----
video.addEventListener('timeupdate', () => {
  $('#relogioLive').textContent = hms1(video.currentTime);
  const total = duracaoLive();
  if (total) $('#agulha').style.left = pct(video.currentTime, total);
  const t = video.currentTime;
  if (!arrastandoAlca && (t < lives.zoomIni + 3 || t > lives.zoomIni + ZOOM - 3)) centralizarZoom(t);
  desenharZoom();
  seguirSequencia();
});
video.addEventListener('loadedmetadata', () => { centralizarZoom(video.currentTime); atualizarTrecho(); });

function pular(s) { video.currentTime = Math.max(0, Math.min(duracaoLive(), video.currentTime + s)); }
$('.pulos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pulo]');
  if (!b) return;
  if (Math.abs(Number(b.dataset.pulo)) < 1) video.pause();
  pular(Number(b.dataset.pulo));
});

function marcarInicio() {
  $('#corteInicio').value = hms1(video.currentTime);
  lives.thumbInicio = fotoQuadro();
  const { fim } = marcas();
  if (!(fim > video.currentTime)) $('#corteFim').value = '';
  atualizarTrecho();
}
function marcarFim() {
  const { ini } = marcas();
  if (!(ini >= 0)) return toast('Marque o início primeiro.', true);
  if (video.currentTime <= ini) return toast('O fim precisa ser depois do início.', true);
  $('#corteFim').value = hms1(video.currentTime);
  atualizarTrecho();
}
$('#marcarInicio').addEventListener('click', marcarInicio);
$('#marcarFim').addEventListener('click', marcarFim);
['#corteInicio', '#corteFim'].forEach((s) => $(s).addEventListener('input', atualizarTrecho));

// ----- sequência -----
// Cada item é um trecho da live ({tipo:'live'}) ou um vídeo de fora da biblioteca
// ({tipo:'clipe'}, ex.: meme). item.tr = transição que ENTRA nesse item.
const TRANSICOES_UI = {
  corte: ['✂', 'Corte seco'], fade: ['◐', 'Dissolver'], fadeblack: ['■', 'Escurecer (preto)'], fadewhite: ['□', 'Clarão (branco)'],
  slideleft: ['⇠', 'Deslizar'], slideup: ['⇡', 'Subir'], smoothleft: ['↞', 'Empurrar suave'], zoomin: ['⊕', 'Zoom'],
  circleopen: ['◎', 'Círculo'], pixelize: ['▦', 'Pixelado'], radial: ['◴', 'Radial'], wipeleft: ['▶', 'Cortina'],
};
const transPadrao = () => ({ tipo: $('#transicaoPadrao').value, duracao: Number($('#transicaoDuracao').value) });
const durItem = (t) => t.fim - t.inicio;
function totalSequencia() {
  return lives.seq.reduce((n, t, i) => n + durItem(t) - (i && t.tr && t.tr.tipo !== 'corte' ? Math.min(t.tr.duracao, durItem(t) / 2, durItem(lives.seq[i - 1]) / 2) : 0), 0);
}

function adicionarCorte() {
  const { ini, fim } = marcas();
  if (!(ini >= 0 && fim > ini)) return toast('Marque o início e o fim do corte.', true);
  if (lives.sel != null && lives.seq[lives.sel].tipo !== 'clipe') {
    Object.assign(lives.seq[lives.sel], { inicio: ini, fim, thumb: lives.thumbInicio || lives.seq[lives.sel].thumb });
    lives.sel = null;
  } else {
    lives.sel = null;
    lives.seq.push({ tipo: 'live', n: proximoCorte++, inicio: ini, fim, thumb: lives.thumbInicio || fotoQuadro(), tr: transPadrao() });
  }
  lives.thumbInicio = null;
  $('#corteInicio').value = '';
  $('#corteFim').value = '';
  desenharSequencia();
  atualizarTrecho();
}
$('#adicionarCorte').addEventListener('click', adicionarCorte);

function desenharSequencia() {
  const faixa = $('#faixaCortes');
  const total = totalSequencia();
  const n = lives.seq.length;
  $('#sequenciaTotal').textContent = n
    ? `${n} parte(s) · ${tempo(total)} no total${total > 180 ? ' — passa de 3 min, no YouTube vira vídeo normal' : total > 90 ? ' — Reels do Facebook aceitam até 90 s' : ''}`
    : 'arraste pra mudar a ordem';
  $('#totalBarra').textContent = n ? `${n} parte(s) · ${tempo(total)}` : 'Nenhum corte ainda';
  $('#salvarSequencia').disabled = !n;
  $('#salvarSeparados').disabled = lives.seq.filter((t) => t.tipo !== 'clipe').length < 2;
  $('#salvarSequencia').textContent = n > 1 ? '💾 Salvar sequência como 1 vídeo' : '💾 Salvar clipe';
  $('#assistirSequencia').disabled = !n;
  faixa.innerHTML = n ? lives.seq.map((t, i) => {
    const tr = t.tr || { tipo: 'corte' };
    const [ic, nomeTr] = TRANSICOES_UI[tr.tipo] || TRANSICOES_UI.corte;
    const junta = i ? `<button type="button" class="junta" data-trans="${i}" title="Transição: ${nomeTr} — clique pra trocar"><span>${ic}</span><small>${tr.tipo === 'corte' ? 'corte' : tr.duracao + 's'}</small></button>` : '';
    const meme = t.tipo === 'clipe';
    return `${junta}
    <div class="corte-card ${lives.sel === i ? 'sel' : ''} ${meme ? 'meme' : ''}" draggable="true" data-i="${i}">
      <div class="corte-thumb">${t.thumb ? `<img src="${esc(t.thumb)}" alt="">` : ''}<span class="corte-n">${i + 1}</span>${meme ? '<span class="corte-tag">DE FORA</span>' : ''}<span class="corte-dur">${tempo(durItem(t))}</span></div>
      <div class="corte-faixa">${meme ? esc(t.nome).slice(0, 26) : hms1(t.inicio) + ' → ' + hms1(t.fim)}</div>
      <div class="corte-acoes">
        <button type="button" class="sec mini" data-tocar="${i}" title="Assistir">▶</button>
        <button type="button" class="sec mini" data-editar="${i}" title="Ajustar início/fim">✎</button>
        <button type="button" class="perigo mini" data-tirar="${i}" title="Tirar da sequência">✕</button>
      </div>
    </div>`;
  }).join('') : '<div class="faixa-vazia">Os cortes aparecem aqui. Arraste pra ordenar, clique entre eles pra escolher a transição, e use "＋ Vídeo de fora" pra colocar meme.</div>';
  desenharBlocos();
}

// ----- transição entre partes -----
function abrirMenuTransicao(i, botao) {
  fecharMenus();
  const atual = lives.seq[i].tr || { tipo: 'corte', duracao: 0.5 };
  const menu = document.createElement('div');
  menu.className = 'menu-transicao';
  menu.innerHTML = `<b>Transição pra parte ${i + 1}</b><div class="grade-trans">${Object.entries(TRANSICOES_UI).map(([k, [ic, nome]]) =>
    `<button type="button" data-escolher-trans="${k}" class="${atual.tipo === k ? 'ativa' : ''}"><span>${ic}</span>${nome}</button>`).join('')}</div>
    <label class="campo">Duração <select data-dur-trans>${[0.3, 0.5, 0.8, 1, 1.5].map((d) => `<option value="${d}" ${Number(atual.duracao) === d ? 'selected' : ''}>${d} s</option>`).join('')}</select></label>
    <button type="button" class="sec mini" data-trans-todas>Usar em todas as junções</button>`;
  $('#dlgLive form').append(menu);
  const r = botao.getBoundingClientRect(); const rf = $('#dlgLive form').getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(rf.width - 330, r.left - rf.left - 140)) + 'px';
  menu.style.top = (r.top - rf.top - 8) + 'px';
  menu.style.transform = 'translateY(-100%)';
  menu.dataset.i = i;
}
function fecharMenus() { $$('.menu-transicao').forEach((m) => m.remove()); }
$('#dlgLive').addEventListener('click', (e) => {
  const menu = e.target.closest('.menu-transicao');
  if (menu) {
    const i = Number(menu.dataset.i);
    const esc1 = e.target.closest('[data-escolher-trans]');
    const dur = Number($('[data-dur-trans]', menu).value);
    if (esc1) { lives.seq[i].tr = { tipo: esc1.dataset.escolherTrans, duracao: dur }; fecharMenus(); desenharSequencia(); }
    if (e.target.closest('[data-trans-todas]')) {
      const tr = { ...(lives.seq[i].tr || { tipo: 'fade' }), duracao: dur };
      lives.seq.forEach((t, k) => { if (k) t.tr = { ...tr }; });
      $('#transicaoPadrao').value = tr.tipo;
      fecharMenus(); desenharSequencia();
    }
    return;
  }
  if (!e.target.closest('[data-trans]')) fecharMenus();
});
$('#dlgLive').addEventListener('change', (e) => {
  const menu = e.target.closest('.menu-transicao');
  if (menu && e.target.matches('[data-dur-trans]')) {
    const i = Number(menu.dataset.i);
    lives.seq[i].tr = { ...(lives.seq[i].tr || { tipo: 'fade' }), duracao: Number(e.target.value) };
    desenharSequencia();
  }
});

// arrastar pra reordenar
let arrastandoCorte = null;
$('#faixaCortes').addEventListener('dragstart', (e) => {
  const card = e.target.closest('.corte-card');
  if (!card) return;
  arrastandoCorte = Number(card.dataset.i);
  card.classList.add('arrastando');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(arrastandoCorte));
});
$('#faixaCortes').addEventListener('dragover', (e) => {
  if (arrastandoCorte == null) return;
  e.preventDefault();
  const card = e.target.closest('.corte-card');
  $$('.corte-card', $('#faixaCortes')).forEach((c) => c.classList.remove('antes', 'depois'));
  if (card && Number(card.dataset.i) !== arrastandoCorte) {
    const r = card.getBoundingClientRect();
    card.classList.add(e.clientX < r.left + r.width / 2 ? 'antes' : 'depois');
  }
});
$('#faixaCortes').addEventListener('drop', (e) => {
  e.preventDefault();
  const card = e.target.closest('.corte-card');
  if (arrastandoCorte == null || !card) return;
  const alvo = Number(card.dataset.i);
  const r = card.getBoundingClientRect();
  let para = e.clientX < r.left + r.width / 2 ? alvo : alvo + 1;
  const [item] = lives.seq.splice(arrastandoCorte, 1);
  if (para > arrastandoCorte) para--;
  lives.seq.splice(para, 0, item);
  lives.sel = null;
  arrastandoCorte = null;
  desenharSequencia();
});
$('#faixaCortes').addEventListener('dragend', () => { arrastandoCorte = null; desenharSequencia(); });

$('#faixaCortes').addEventListener('click', (e) => {
  const tr = e.target.closest('[data-trans]');
  if (tr) { e.stopPropagation(); return abrirMenuTransicao(Number(tr.dataset.trans), tr); }
  const tocar = e.target.closest('[data-tocar]');
  const editar = e.target.closest('[data-editar]');
  const tirar = e.target.closest('[data-tirar]');
  if (tocar) tocarLista([lives.seq[Number(tocar.dataset.tocar)]]);
  else if (editar) {
    const i = Number(editar.dataset.editar);
    const t = lives.seq[i];
    if (t.tipo === 'clipe') return editarMeme(i);
    lives.sel = lives.sel === i ? null : i;
    $('#corteInicio').value = lives.sel != null ? hms1(t.inicio) : '';
    $('#corteFim').value = lives.sel != null ? hms1(t.fim) : '';
    if (lives.sel != null) { video.currentTime = t.inicio; centralizarZoom((t.inicio + t.fim) / 2); }
    desenharSequencia();
    atualizarTrecho();
  } else if (tirar) {
    lives.seq.splice(Number(tirar.dataset.tirar), 1);
    lives.sel = null;
    desenharSequencia();
    atualizarTrecho();
  }
});

// ----- vídeo de fora (meme) -----
const extra = $('#videoExtra');
function abrirMemes() {
  const prontos = estado.clipes.filter((c) => c.estado === 'pronto');
  $('#listaMemes').innerHTML = prontos.length ? prontos.map((c) => `
    <button type="button" class="meme-op" data-meme="${c.id}">
      ${c.temMiniatura ? `<img src="/midia/${c.id}/miniatura" alt="" loading="lazy">` : '<span class="img-vazia"></span>'}
      <span><b>${esc(c.nome)}</b><small>${tempo(c.info.duracao)} · ${c.info.largura}×${c.info.altura}</small></span>
    </button>`).join('') : '<p class="dica">Sua biblioteca está vazia. Envie um vídeo do PC ou cole um link.</p>';
  $('#dlgMeme').showModal();
}
$('#botaoMeme').addEventListener('click', abrirMemes);
function colocarMeme(c) {
  const d = c.info.duracao;
  lives.seq.push({ tipo: 'clipe', clipeId: c.id, nome: c.nome, inicio: 0, fim: Math.min(d, 20), max: d, thumb: c.temMiniatura ? '/midia/' + c.id + '/miniatura' : null, tr: transPadrao() });
  desenharSequencia();
  toast('Vídeo colocado no fim da sequência. Arraste pra onde quiser.' + (d > 20 ? ' (usei os primeiros 20 s; ✎ pra ajustar)' : ''));
}
$('#listaMemes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-meme]');
  if (!b) return;
  colocarMeme(estado.clipes.find((c) => c.id === b.dataset.meme));
  $('#dlgMeme').close();
});
// enviar do PC ou por link: espera ficar pronto e já coloca na sequência
async function esperarClipe(id, aviso) {
  aviso.innerHTML = '<i class="giro"></i>Preparando o vídeo…';
  for (let k = 0; k < 400; k++) {
    await carregarClipes();
    const c = estado.clipes.find((x) => x.id === id);
    if (c && c.estado === 'pronto') { aviso.textContent = ''; colocarMeme(c); $('#dlgMeme').close(); return; }
    if (!c || c.estado === 'erro') { aviso.textContent = 'Falhou: ' + (c ? c.erro : 'sumiu'); return; }
    aviso.innerHTML = `<i class="giro"></i>${esc(c.etapa || 'preparando')} ${c.progresso ? c.progresso + '%' : ''}`;
    await new Promise((r) => setTimeout(r, 1500));
  }
}
$('#memeArquivo').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const aviso = $('#memeAviso');
  const x = new XMLHttpRequest();
  x.open('PUT', '/api/clipes/enviar?nome=' + encodeURIComponent(f.name));
  x.setRequestHeader('X-Postador', '1');
  x.upload.onprogress = (ev) => { if (ev.lengthComputable) aviso.textContent = 'Enviando ' + Math.round((ev.loaded / ev.total) * 100) + '%'; };
  x.onload = () => {
    let j = {};
    try { j = JSON.parse(x.responseText); } catch (err) { /* */ }
    if (x.status >= 400) aviso.textContent = j.erro || 'Falhou o envio.';
    else esperarClipe(j.id, aviso);
  };
  x.send(f);
});
$('#memeLinkBotao').addEventListener('click', async () => {
  const url = $('#memeLink').value.trim();
  if (!url) return;
  try {
    const c = await api('POST', '/api/clipes/link', { url, vertical: false });
    $('#memeLink').value = '';
    esperarClipe(c.id, $('#memeAviso'));
  } catch (err) { $('#memeAviso').textContent = err.message; }
});
function editarMeme(i) {
  const t = lives.seq[i];
  const ini = prompt(`Começar em quantos segundos? (o vídeo tem ${tempo(t.max)})`, String(t.inicio));
  if (ini == null) return;
  const fim = prompt('Terminar em quantos segundos?', String(t.fim));
  if (fim == null) return;
  const a = Math.max(0, Number(String(ini).replace(',', '.')) || 0);
  const b = Math.min(t.max || Infinity, Number(String(fim).replace(',', '.')) || 0);
  if (!(b > a)) return toast('O fim precisa ser depois do começo.', true);
  Object.assign(t, { inicio: a, fim: b });
  desenharSequencia();
}

// ----- prévia (toca a live e os vídeos de fora em ordem) -----
function tocarLista(lista) {
  if (!lista.length) return;
  lives.tocando = { lista, i: 0 };
  tocarItem(lista[0]);
}
function tocarItem(t) {
  if (t.tipo === 'clipe') {
    video.pause();
    extra.hidden = false;
    const src = '/midia/' + t.clipeId + '/video';
    if (!extra.src.endsWith(src)) extra.src = src;
    extra.currentTime = t.inicio;
    extra.play();
  } else {
    extra.pause();
    extra.hidden = true;
    video.currentTime = t.inicio;
    video.play();
  }
}
function proximoDaLista() {
  const t = lives.tocando;
  t.i++;
  if (t.i >= t.lista.length) { video.pause(); extra.pause(); extra.hidden = true; lives.tocando = null; return; }
  tocarItem(t.lista[t.i]);
}
function seguirSequencia() {
  const t = lives.tocando;
  if (!t || video.paused) return;
  const atual = t.lista[t.i];
  if (atual.tipo !== 'clipe' && video.currentTime >= atual.fim) proximoDaLista();
}
extra.addEventListener('timeupdate', () => {
  const t = lives.tocando;
  if (!t || extra.paused) return;
  const atual = t.lista[t.i];
  if (atual.tipo === 'clipe' && extra.currentTime >= atual.fim) proximoDaLista();
});
extra.addEventListener('ended', () => { if (lives.tocando) proximoDaLista(); });
video.addEventListener('pause', () => {
  const t = lives.tocando;
  if (t && !video.seeking && t.lista[t.i] && t.lista[t.i].tipo !== 'clipe') lives.tocando = null;
});
$('#assistirSequencia').addEventListener('click', () => tocarLista(lives.seq));

// ----- atalhos -----
// Enter num campo não fecha o editor (antes perdia a sequência inteira)
$('#dlgLive form').addEventListener('submit', (e) => {
  if (!e.submitter || e.submitter.value !== 'fechar') e.preventDefault();
});
// fase de captura: o atalho vale mesmo com o foco no player, sem o player agir junto
$('#dlgLive').addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) {
    if (e.key === 'Enter') { e.preventDefault(); if (e.target.matches('#corteInicio, #corteFim')) adicionarCorte(); }
    return;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  const acoes = {
    ' ': () => (video.paused ? video.play() : video.pause()),
    arrowleft: () => pular(e.shiftKey ? -10 : -1),
    arrowright: () => pular(e.shiftKey ? 10 : 1),
    ',': () => { video.pause(); pular(-1 / 30); },
    '.': () => { video.pause(); pular(1 / 30); },
    i: marcarInicio,
    o: marcarFim,
    a: adicionarCorte,
  };
  if (acoes[k]) { e.preventDefault(); e.stopPropagation(); acoes[k](); }
}, true);

// ----- salvar -----
const paraApi = (t) => (t.tipo === 'clipe' ? { tipo: 'clipe', clipeId: t.clipeId, inicio: t.inicio, fim: t.fim } : { tipo: 'live', inicio: t.inicio, fim: t.fim });
async function salvarCortes(grupos) {
  const a = lives.aberta;
  if (!a) return;
  const botoes = [$('#salvarSequencia'), $('#salvarSeparados')];
  botoes.forEach((b) => { b.disabled = true; });
  const nomeBase = $('#corteNome').value.trim() || a.titulo || 'Clipe da live';
  const formatos = formatosParaSalvar();
  let feitos = 0;
  try {
    for (let g = 0; g < grupos.length; g++) {
      const grupo = grupos[g];
      for (const f of formatos) {
        const c = await api('POST', '/api/lives/' + a.plat + '/' + a.id + '/cortar', {
          itens: grupo.map(paraApi),
          transicoes: grupo.slice(1).map((t) => t.tr || { tipo: 'corte' }),
          nome: (grupos.length > 1 ? nomeBase + ' ' + (g + 1) : nomeBase) + f.sufixo,
          formato: f.formato, layout: f.layout, titulo: a.titulo,
        });
        lives.cortes.unshift(c.id);
        feitos++;
      }
    }
    lives.seq = [];
    lives.sel = null;
    atualizarTrecho();
    await carregarClipes();
    desenharCortes();
    toast(feitos > 1 ? feitos + ' vídeos sendo gerados.' : 'Gerando o vídeo! Pode montar outro enquanto isso.');
  } catch (e) { toast(e.message, true); }
  desenharSequencia();
}
$('#salvarSequencia').addEventListener('click', () => salvarCortes([lives.seq.slice()]));
$('#salvarSeparados').addEventListener('click', () => salvarCortes(lives.seq.filter((t) => t.tipo !== 'clipe').map((t) => [t])));

function desenharCortes() {
  if (!lives.cortes.length) { $('#cortesFeitos').innerHTML = ''; return; }
  $('#cortesFeitos').innerHTML = '<h4>Clipes gerados desta live</h4>' + lives.cortes.map((id) => {
    const c = estado.clipes.find((x) => x.id === id);
    if (!c) return '';
    const st = c.estado === 'pronto' ? `<button type="button" class="mini" data-postar-corte="${id}">Postar</button>`
      : c.estado === 'erro' ? `<span class="apagar-erro">${esc(c.erro)}</span>`
        : `<span class="dica"><i class="giro"></i>${c.progresso ? c.progresso + '%' : esc(c.etapa || 'processando')}</span>`;
    return `<div class="corte-feito"><span>${esc(c.nome)}</span>${st}</div>`;
  }).join('');
}
setInterval(() => { if (lives.aberta && lives.cortes.length) desenharCortes(); }, 1200);
$('#cortesFeitos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-postar-corte]');
  if (!b) return;
  $('#dlgLive').close();
  escolherClipe(b.dataset.postarCorte);
  irPara('postar');
});

aoAbrirAba.lives = () => carregarLives();
