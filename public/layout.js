'use strict';
// Layout 9:16 do editor de lives: onde está a câmera e o jogo no vídeo original,
// como eles ficam no celular (faixa, câmera redonda por cima, sem câmera…) e
// uma prévia ao vivo. Fica salvo nas preferências pra valer nos próximos cortes.

const LAYOUT_PADRAO = {
  modo: 'faixa-topo', proporcao: 0.35, forma: 'redonda', tamanho: 0.45, pos: { x: 0.5, y: 0.2 }, borda: 'branca', esconder: true,
  cam: { x: 0.03, y: 0.6, w: 0.24, h: 0.38 },
  jogo: { x: 0.3, y: 0, w: 0.4, h: 1 },
};
let layout = JSON.parse(JSON.stringify(LAYOUT_PADRAO));
const vid = $('#videoLive');
const tela = $('#previa916');
const pincel = tela.getContext('2d');

const COM_RECORTE = ['faixa-topo', 'faixa-baixo', 'sobre', 'sem-camera'];
const usaCamera = () => ['faixa-topo', 'faixa-baixo', 'sobre'].includes(layout.modo);

// proporção (largura/altura em pixels) que cada recorte precisa ter pro modo atual
function aspectoAlvo(qual) {
  const ch = 1920 * layout.proporcao;
  if (qual === 'cam') {
    if (layout.modo === 'sobre') return layout.forma === 'retangular' ? 16 / 9 : 1;
    return 1080 / ch;
  }
  if (layout.modo === 'faixa-topo' || layout.modo === 'faixa-baixo') return 1080 / (1920 - ch);
  return 1080 / 1920;
}
const proporcaoVideo = () => (vid.videoWidth && vid.videoHeight ? vid.videoWidth / vid.videoHeight : 16 / 9);

// mantém o recorte no aspecto certo e dentro do vídeo
function ajustarCaixa(qual, ancora = 'centro') {
  const r = layout[qual];
  const pv = proporcaoVideo();
  const a = aspectoAlvo(qual);
  const cx = r.x + r.w / 2; const cy = r.y + r.h / 2;
  let w = r.w; let h = (w * pv) / a;
  if (h > 1) { h = 1; w = (h * a) / pv; }
  if (w > 1) { w = 1; h = (w * pv) / a; }
  let x = ancora === 'centro' ? cx - w / 2 : r.x;
  let y = ancora === 'centro' ? cy - h / 2 : r.y;
  x = Math.max(0, Math.min(1 - w, x));
  y = Math.max(0, Math.min(1 - h, y));
  layout[qual] = { x, y, w, h };
}

// ---------- controles ----------
function mostrarControles() {
  $('#painel916').hidden = !$('#saida916').checked;
  $('#layoutModo').value = layout.modo;
  $('#layoutProporcao').value = Math.round(layout.proporcao * 100);
  $('#valorProporcao').textContent = Math.round(layout.proporcao * 100) + '%';
  $('#layoutTamanho').value = Math.round(layout.tamanho * 100);
  $('#valorTamanho').textContent = Math.round(layout.tamanho * 100) + '%';
  $('#layoutBorda').value = layout.borda;
  $('#layoutEsconder').checked = layout.esconder !== false;
  $$('#layoutForma button').forEach((b) => b.classList.toggle('ativa', b.dataset.forma === layout.forma));
  $$('.op-layout').forEach((el) => { el.hidden = !el.dataset.para.split(' ').includes(layout.modo); });
  if (!COM_RECORTE.includes(layout.modo)) ajustandoRecortes(false);
  desenharRecortes();
}

let salvarDepois;
function mudou(recalcular) {
  if (recalcular) { ajustarCaixa('jogo'); ajustarCaixa('cam'); }
  mostrarControles();
  clearTimeout(salvarDepois);
  salvarDepois = setTimeout(() => api('POST', '/api/preferencias', { layoutVertical: layout }).catch(() => {}), 800);
}

$('#layoutModo').addEventListener('change', (e) => { layout.modo = e.target.value; mudou(true); });
$('#layoutProporcao').addEventListener('input', (e) => { layout.proporcao = Number(e.target.value) / 100; mudou(true); });
$('#layoutTamanho').addEventListener('input', (e) => { layout.tamanho = Number(e.target.value) / 100; mudou(false); });
$('#layoutBorda').addEventListener('change', (e) => { layout.borda = e.target.value; mudou(false); });
$('#layoutEsconder').addEventListener('change', (e) => { layout.esconder = e.target.checked; mudou(false); });
$('#layoutForma').addEventListener('click', (e) => {
  const b = e.target.closest('[data-forma]');
  if (!b) return;
  layout.forma = b.dataset.forma;
  mudou(true);
});
['#saida916', '#saida169'].forEach((s) => $(s).addEventListener('change', () => {
  if (!$('#saida916').checked && !$('#saida169').checked) $(s === '#saida916' ? '#saida169' : '#saida916').checked = true;
  mostrarControles();
}));

// ---------- caixas de recorte em cima do vídeo ----------
function areaDoVideo() {
  // o vídeo pode ter tarjas (object-fit: contain): acha onde a imagem está de fato
  const ew = vid.clientWidth; const eh = vid.clientHeight;
  const pv = proporcaoVideo();
  let w = ew; let h = ew / pv;
  if (h > eh) { h = eh; w = eh * pv; }
  return { x: (ew - w) / 2, y: (eh - h) / 2, w, h };
}
function desenharRecortes() {
  const cx = $('#recortes');
  if (cx.hidden) return;
  const a = areaDoVideo();
  Object.assign(cx.style, { left: a.x + 'px', top: a.y + 'px', width: a.w + 'px', height: a.h + 'px' });
  for (const qual of ['jogo', 'cam']) {
    const el = $(`[data-caixa="${qual}"]`, cx);
    const r = layout[qual];
    el.hidden = qual === 'cam' && !usaCamera() && !layout.esconder;
    Object.assign(el.style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' });
    el.classList.toggle('redonda', qual === 'cam' && layout.modo === 'sobre' && layout.forma === 'redonda');
  }
}
function ajustandoRecortes(ligar) {
  $('#recortes').hidden = !ligar;
  $('#ajustarRecortes').classList.toggle('ativa', ligar);
  $('#ajustarRecortes').textContent = ligar ? '✓ Pronto (voltar pros controles do vídeo)' : '✥ Ajustar recortes no vídeo';
  if (ligar) { vid.pause(); desenharRecortes(); }
}
$('#ajustarRecortes').addEventListener('click', () => ajustandoRecortes($('#recortes').hidden));
window.addEventListener('resize', desenharRecortes);

let arrasto = null;
$('#recortes').addEventListener('pointerdown', (e) => {
  const canto = e.target.closest('[data-canto]');
  const caixa = e.target.closest('[data-caixa]');
  if (!caixa) return;
  const qual = canto ? canto.dataset.canto : caixa.dataset.caixa;
  const a = $('#recortes').getBoundingClientRect();
  arrasto = { qual, tipo: canto ? 'tamanho' : 'mover', x0: e.clientX, y0: e.clientY, r0: { ...layout[qual] }, aw: a.width, ah: a.height };
  e.currentTarget.setPointerCapture(e.pointerId);
  e.preventDefault();
});
$('#recortes').addEventListener('pointermove', (e) => {
  if (!arrasto) return;
  const dx = (e.clientX - arrasto.x0) / arrasto.aw;
  const dy = (e.clientY - arrasto.y0) / arrasto.ah;
  const r0 = arrasto.r0;
  if (arrasto.tipo === 'mover') {
    layout[arrasto.qual] = { ...r0, x: Math.max(0, Math.min(1 - r0.w, r0.x + dx)), y: Math.max(0, Math.min(1 - r0.h, r0.y + dy)) };
  } else {
    layout[arrasto.qual] = { ...r0, w: Math.max(0.04, Math.min(1 - r0.x, r0.w + dx)) };
    ajustarCaixa(arrasto.qual, 'canto');
  }
  desenharRecortes();
});
$('#recortes').addEventListener('pointerup', () => { if (arrasto) { arrasto = null; mudou(false); } });

// ---------- prévia 9:16 ----------
const W = 270; const H = 480; // 1080x1920 / 4
function desenharFonte(r, dx, dy, dw, dh) {
  const vw = vid.videoWidth; const vh = vid.videoHeight;
  pincel.drawImage(vid, r.x * vw, r.y * vh, r.w * vw, r.h * vh, dx, dy, dw, dh);
  // borra a câmera original que cai dentro deste recorte
  if (layout.esconder && usaCamera() || (layout.esconder && layout.modo === 'sem-camera')) {
    const c = layout.cam;
    const ix = Math.max(r.x, c.x); const iy = Math.max(r.y, c.y);
    const fx = Math.min(r.x + r.w, c.x + c.w); const fy = Math.min(r.y + r.h, c.y + c.h);
    if (fx > ix && fy > iy) {
      pincel.save();
      pincel.filter = 'blur(8px)';
      pincel.drawImage(vid, ix * vw, iy * vh, (fx - ix) * vw, (fy - iy) * vh,
        dx + ((ix - r.x) / r.w) * dw, dy + ((iy - r.y) / r.h) * dh, ((fx - ix) / r.w) * dw, ((fy - iy) / r.h) * dh);
      pincel.restore();
    }
  }
}
function caminhoForma(x, y, w, h) {
  const raio = layout.forma === 'redonda' ? w / 2 : Math.min(w, h) * (layout.forma === 'quadrada' ? 0.16 : 0.1);
  pincel.beginPath();
  pincel.roundRect(x, y, w, h, raio);
}
function desenharPrevia() {
  requestAnimationFrame(desenharPrevia);
  if (!$('#dlgLive').open || $('#painel916').hidden || !vid.videoWidth) return;
  pincel.fillStyle = '#000';
  pincel.fillRect(0, 0, W, H);
  const vw = vid.videoWidth; const vh = vid.videoHeight;
  const m = layout.modo;
  if (m === 'desfocado') {
    pincel.save(); pincel.filter = 'blur(10px) brightness(.9)';
    const s = Math.max(W / vw, H / vh);
    pincel.drawImage(vid, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s);
    pincel.restore();
    const s2 = Math.min(W / vw, H / vh);
    pincel.drawImage(vid, (W - vw * s2) / 2, (H - vh * s2) / 2, vw * s2, vh * s2);
    return;
  }
  if (m === 'cortado') {
    const s = Math.max(W / vw, H / vh);
    pincel.drawImage(vid, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s);
    return;
  }
  if (m === 'sem-camera') { desenharFonte(layout.jogo, 0, 0, W, H); return; }
  if (m === 'faixa-topo' || m === 'faixa-baixo') {
    const ch = Math.round(H * layout.proporcao);
    const c = layout.cam;
    if (m === 'faixa-topo') {
      pincel.drawImage(vid, c.x * vw, c.y * vh, c.w * vw, c.h * vh, 0, 0, W, ch);
      desenharFonte(layout.jogo, 0, ch, W, H - ch);
    } else {
      desenharFonte(layout.jogo, 0, 0, W, H - ch);
      pincel.drawImage(vid, c.x * vw, c.y * vh, c.w * vw, c.h * vh, 0, H - ch, W, ch);
    }
    return;
  }
  // sobre
  desenharFonte(layout.jogo, 0, 0, W, H);
  const cw = W * layout.tamanho;
  const chh = layout.forma === 'retangular' ? cw * 9 / 16 : cw;
  const x = Math.max(0, Math.min(W - cw, layout.pos.x * W - cw / 2));
  const y = Math.max(0, Math.min(H - chh, layout.pos.y * H - chh / 2));
  const c = layout.cam;
  pincel.save();
  caminhoForma(x, y, cw, chh);
  pincel.clip();
  pincel.drawImage(vid, c.x * vw, c.y * vh, c.w * vw, c.h * vh, x, y, cw, chh);
  pincel.restore();
  if (layout.borda !== 'nenhuma') {
    caminhoForma(x, y, cw, chh);
    pincel.lineWidth = Math.max(2, cw * 0.022 * 2);
    pincel.strokeStyle = { branca: '#fff', roxa: '#8b5cf6', preta: '#000' }[layout.borda];
    pincel.stroke();
  }
}
requestAnimationFrame(desenharPrevia);

// arrastar a câmera na prévia (modo "sobre")
let arrastoPrevia = null;
tela.addEventListener('pointerdown', (e) => {
  if (layout.modo !== 'sobre') return;
  const r = tela.getBoundingClientRect();
  arrastoPrevia = { r };
  tela.setPointerCapture(e.pointerId);
  moverBolha(e);
});
function moverBolha(e) {
  const r = arrastoPrevia.r;
  layout.pos = { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
}
tela.addEventListener('pointermove', (e) => { if (arrastoPrevia) moverBolha(e); });
tela.addEventListener('pointerup', () => { if (arrastoPrevia) { arrastoPrevia = null; mudou(false); } });

// ---------- o que salvar ----------
// Cada formato marcado vira um clipe (ou uma sequência) separado.
function formatosParaSalvar() {
  const lista = [];
  const ambos = $('#saida916').checked && $('#saida169').checked;
  if ($('#saida916').checked) {
    const m = layout.modo;
    const formato = m === 'desfocado' ? 'vertical-desfocado' : m === 'cortado' ? 'vertical-cortado' : 'vertical-layout';
    lista.push({ formato, layout: formato === 'vertical-layout' ? JSON.parse(JSON.stringify(layout)) : undefined, sufixo: ambos ? ' (9x16)' : '' });
  }
  if ($('#saida169').checked) lista.push({ formato: 'original', sufixo: ambos ? ' (16x9)' : '' });
  return lista;
}

// carrega o layout salvo quando o editor abre
async function carregarLayout() {
  try {
    const p = await api('GET', '/api/preferencias');
    if (p.layoutVertical) layout = { ...JSON.parse(JSON.stringify(LAYOUT_PADRAO)), ...p.layoutVertical };
  } catch (e) { /* fica o padrão */ }
  mostrarControles();
}
vid.addEventListener('loadedmetadata', () => { ajustarCaixa('jogo'); ajustarCaixa('cam'); desenharRecortes(); });
$('#dlgLive').addEventListener('close', () => ajustandoRecortes(false));
