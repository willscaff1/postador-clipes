// Estudio: pega uma live inteira, acha os momentos fortes sozinho (so pela
// propria live: som e imagem), monta um video longo de 20-30 min pro YouTube
// e gera thumbnails chamativas automaticas.
//
// Sinais usados (por segundo da live):
//  - volume da voz/jogo (grito, reacao, confusao)
//  - estouros curtos no audio (tiro)
//  - movimento na tela (perseguicao, correria)
//  - luz de sirene vermelha/azul (policia)
// A transcricao da fala (whisper) entra depois pra separar engracado/conversa.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const cofre = require('./cofre');
const lives = require('./lives');
const clipes = require('./clipes');

const PASTA = path.join(cofre.DADOS, 'estudio');
const ambiente = require('./ambiente');
const fonteFiltro = ambiente.fonteFiltro(ambiente.fonte('grossa'));

const TIPOS = {
  tiro: { rotulo: 'Troca de tiro', emoji: '🔫' },
  fuga: { rotulo: 'Fuga / perseguição', emoji: '🚔' },
  agito: { rotulo: 'Momento quente', emoji: '🔥' },
  engracado: { rotulo: 'Engraçado', emoji: '😂' },
  conversa: { rotulo: 'Conversa importante', emoji: '🗣' },
  reacao: { rotulo: 'Reação', emoji: '😱' },
};

const jobs = new Map();

function pastaJob(id) { return path.join(PASTA, id); }
function salvar(job) {
  fs.mkdirSync(pastaJob(job.id), { recursive: true });
  cofre.gravarAtomico(path.join(pastaJob(job.id), 'job.json'), JSON.stringify(job, null, 1));
}
function carregarTodos() {
  if (!fs.existsSync(PASTA)) return;
  for (const d of fs.readdirSync(PASTA)) {
    if (jobs.has(d)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(PASTA, d, 'job.json'), 'utf8'));
      if (['analisando', 'montando', 'gerando thumbs'].includes(j.estado)) { j.estado = 'erro'; j.erro = 'O app foi fechado no meio do processamento.'; }
      jobs.set(d, j);
    } catch (e) { /* pasta sem job */ }
  }
}

function listar() {
  carregarTodos();
  return [...jobs.values()].map((j) => ({
    id: j.id, plat: j.plat, liveId: j.liveId, titulo: j.titulo, criadoEm: j.criadoEm, estado: j.estado, etapa: j.etapa,
    progresso: j.progresso, momentos: (j.momentos || []).length, clipeId: j.clipeId,
  })).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}
function obter(id) {
  carregarTodos();
  const j = jobs.get(id);
  if (!j) throw new Error('Analise nao encontrada.');
  return j;
}

function rodarFfmpeg(args, { cwd, aoTempo, aoStdout } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { cwd, windowsHide: true });
    let erro = '';
    p.stderr.on('data', (d) => {
      const t = d.toString();
      erro = (erro + t).slice(-20000);
      const m = /time=(\d+):(\d+):(\d+\.?\d*)/.exec(t);
      if (m && aoTempo) aoTempo(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
    if (aoStdout) p.stdout.on('data', aoStdout);
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg: ' + erro.trim().split(/\r?\n/).slice(-2).join(' | ')))));
  });
}

// ---------- estatistica ----------
const media = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
function percentil(a, p) {
  const o = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!o.length) return 0;
  return o[Math.min(o.length - 1, Math.floor(p * o.length))];
}
function zRobusto(a) {
  const med = percentil(a, 0.5);
  const mad = percentil(a.map((x) => Math.abs(x - med)), 0.5) || 1;
  return a.map((x) => (x - med) / (1.4826 * mad));
}
function suavizar(a, janela) {
  const out = new Array(a.length).fill(0);
  let soma = 0;
  const q = [];
  for (let i = 0; i < a.length; i++) {
    q.push(a[i]); soma += a[i];
    if (q.length > janela) soma -= q.shift();
    out[i] = soma / q.length;
  }
  // centraliza a janela
  const d = Math.floor(janela / 2);
  return out.map((_, i) => out[Math.min(a.length - 1, i + d)]);
}

// ---------- tiro ----------
// Tiro nao e "som alto": e um estouro que sobe >= 18 dB em ~20 ms e soa como
// chiado (muita energia espalhada e nos agudos). Voz comecando depois de pausa
// sobe mais devagar e tem tom (harmonicos), entao nao passa no teste do espectro.
function fft(re, im) {
  const N = re.length;
  for (let a = 1, j = 0; a < N; a++) {
    let b = N >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (a < j) { [re[a], re[j]] = [re[j], re[a]]; [im[a], im[j]] = [im[j], im[a]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let a = 0; a < N; a += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(ang * k); const s = Math.sin(ang * k);
        const i2 = a + k + len / 2;
        const vr = re[i2] * c - im[i2] * s; const vi = re[i2] * s + im[i2] * c;
        re[i2] = re[a + k] - vr; im[i2] = im[a + k] - vi;
        re[a + k] += vr; im[a + k] += vi;
      }
    }
  }
}

// Devolve o segundo de cada tiro encontrado (WAV mono 16 kHz, 16 bits).
function detectarTiros(wav, ini) {
  const n = Math.floor((wav.length - ini) / 2);
  const Q = 80; // 5 ms
  const nq = Math.floor(n / Q);
  const e = new Float32Array(nq);
  for (let q = 0; q < nq; q++) {
    let s = 0;
    for (let k = 0; k < Q; k++) { const v = wav.readInt16LE(ini + (q * Q + k) * 2) / 32768; s += v * v; }
    e[q] = 10 * Math.log10(s / Q + 1e-12);
  }
  const achados = [];
  let ultimo = -1e9;
  const re = new Float64Array(512); const im = new Float64Array(512);
  for (let q = 8; q < nq - 8; q++) {
    if (e[q] < -24 || q - ultimo < 30) continue;
    const antes = Math.max(e[q - 6], e[q - 5], e[q - 4], e[q - 3]);
    if (e[q] - antes < 18) continue;
    for (let k = 0; k < 512; k++) {
      const p = ini + (q * Q + k) * 2;
      re[k] = (p + 1 < wav.length ? wav.readInt16LE(p) / 32768 : 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / 511));
      im[k] = 0;
    }
    fft(re, im);
    let somaLog = 0; let soma = 0; let agudo = 0;
    for (let b = 2; b < 256; b++) {
      const pot = re[b] * re[b] + im[b] * im[b] + 1e-12;
      somaLog += Math.log(pot); soma += pot;
      if (b >= 96) agudo += pot; // acima de 3 kHz
    }
    const plano = Math.exp(somaLog / 254) / (soma / 254);
    if (plano >= 0.25 && agudo / soma >= 0.25) { achados.push(Math.floor((q * Q) / 16000)); ultimo = q; }
  }
  return achados;
}

// ---------- analise ----------
// Baixa a versao 160p (leve, com audio): sai um WAV 16 kHz e quadrinhos 64x36.
async function extrairSinais(job, url160) {
  const dir = pastaJob(job.id);
  const QW = 64; const QH = 36; const TAM = QW * QH * 3;
  const mov = []; const sirene = [];
  let anterior = null;
  let sobra = Buffer.alloc(0);
  const aoStdout = (pedaco) => {
    let buf = sobra.length ? Buffer.concat([sobra, pedaco]) : pedaco;
    while (buf.length >= TAM) {
      const q = buf.subarray(0, TAM);
      let dif = 0; let verm = 0; let azul = 0;
      for (let i = 0; i < TAM; i += 3) {
        const r = q[i]; const g = q[i + 1]; const b = q[i + 2];
        if (anterior) dif += Math.abs(r - anterior[i]) + Math.abs(g - anterior[i + 1]) + Math.abs(b - anterior[i + 2]);
        if (r > 190 && g < 90 && b < 110) verm++;
        if (b > 190 && r < 90 && g < 150) azul++;
      }
      mov.push(anterior ? dif / TAM : 0);
      sirene.push({ verm, azul });
      anterior = Buffer.from(q);
      buf = buf.subarray(TAM);
    }
    sobra = Buffer.from(buf);
  };
  await rodarFfmpeg(['-hide_banner', '-nostdin', '-y', '-i', url160,
    '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', 'audio.wav',
    '-map', '0:v:0', '-vf', `fps=2,scale=${QW}:${QH},format=rgb24`, '-f', 'rawvideo', 'pipe:1'],
  { cwd: dir, aoStdout, aoTempo: (t) => { job.progresso = Math.min(95, Math.round((t / (job.duracao || 1)) * 95)); job.etapa = 'baixando e ouvindo a live (' + hmsTexto(t) + ' de ' + hmsTexto(job.duracao) + ')'; } });

  // audio: volume por 100 ms
  const wav = fs.readFileSync(path.join(dir, 'audio.wav'));
  let ini = 12;
  while (ini < wav.length - 8 && wav.toString('ascii', ini, ini + 4) !== 'data') ini += 8 + wav.readUInt32LE(ini + 4);
  ini += 8;
  const JAN = 1600;
  const db = [];
  for (let p = ini; p + JAN * 2 <= wav.length; p += JAN * 2) {
    let s = 0;
    for (let k = 0; k < JAN; k++) { const v = wav.readInt16LE(p + k * 2) / 32768; s += v * v; }
    db.push(10 * Math.log10(s / JAN + 1e-10));
  }
  const seg = Math.ceil(db.length / 10);
  const vol = []; const tiros = new Array(seg).fill(0);
  for (let i = 0; i < seg; i++) {
    const fatia = db.slice(i * 10, i * 10 + 10);
    vol.push(10 * Math.log10(media(fatia.map((x) => 10 ** (x / 10))) + 1e-10));
  }
  for (const t of detectarTiros(wav, ini)) if (t < seg) tiros[t]++;
  // video: 2 quadros por segundo -> por segundo
  const movS = []; const sirS = [];
  for (let i = 0; i < seg; i++) {
    movS.push(media(mov.slice(i * 2, i * 2 + 2)));
    const s = sirene.slice(i * 2, i * 2 + 2);
    // sirene = vermelho e azul fortes ao mesmo tempo ou piscando
    sirS.push(s.some((x) => x.verm >= 6) && s.some((x) => x.azul >= 6) ? 1 : 0);
  }
  return { vol, tiros, mov: movS, sirene: sirS };
}

function acharMomentos(s, duracao, conteudo = 'rp') {
  const react = conteudo === 'react';
  const n = s.vol.length;
  const zv = zRobusto(s.vol);
  const zm = zRobusto(s.mov);
  const sirJ = suavizar(s.sirene, 10);
  const bruto = [];
  for (let i = 0; i < n; i++) {
    const t = Math.min(s.tiros[i], 4);
    bruto.push(react
      ? Math.max(-1, 1.3 * zv[i] + 0.25 * Math.max(-1, zm[i]))
      : Math.max(-1, 0.9 * zv[i] + 1.1 * t + 0.5 * Math.max(-1, zm[i]) + (sirJ[i] > 0.3 ? 1.2 : 0)));
  }
  const liso = suavizar(bruto, 20);
  const alta = percentil(liso, 0.9);
  const baixa = percentil(liso, 0.72);
  let momentos = [];
  for (let i = 0; i < n; i++) {
    if (liso[i] < alta) continue;
    let a = i; let b = i;
    while (a > 0 && liso[a - 1] > baixa) a--;
    while (b < n - 1 && liso[b + 1] > baixa) b++;
    momentos.push({ inicio: Math.max(0, a - 8), fim: Math.min(duracao || n, b + 4) });
    i = b;
  }
  // junta vizinhos e limita tamanho
  const juntos = [];
  for (const m of momentos) {
    const u = juntos[juntos.length - 1];
    if (u && m.inicio - u.fim < 12) u.fim = Math.max(u.fim, m.fim); else juntos.push({ ...m });
  }
  momentos = [];
  for (const m of juntos) {
    let { inicio, fim } = m;
    if (fim - inicio < 20) { const c = (inicio + fim) / 2; inicio = Math.max(0, c - 10); fim = Math.min(n, c + 10); }
    if (fim - inicio > 180) {
      let pico = inicio;
      for (let i = inicio; i < fim; i++) if (liso[i] > liso[pico]) pico = i;
      inicio = Math.max(inicio, pico - 110); fim = Math.min(fim, inicio + 180);
    }
    const faixa = (arr) => arr.slice(Math.floor(inicio), Math.ceil(fim));
    const dur = fim - inicio;
    const tirosT = faixa(s.tiros).reduce((x, y) => x + y, 0);
    const sirF = media(faixa(s.sirene));
    const movZ = media(faixa(zm));
    let tipo = react ? 'reacao' : 'agito';
    if (react) { /* reacao */ } else if (tirosT >= 4 && tirosT / dur >= 0.05) tipo = 'tiro';
    else if (sirF >= 0.15 || (movZ > 0.8 && dur >= 45)) tipo = 'fuga';
    let pico = Math.floor(inicio); // ponto mais alto de volume = cara de reacao pra thumbnail
    for (let i = Math.floor(inicio); i < Math.ceil(fim); i++) if (s.vol[i] > s.vol[pico]) pico = i;
    const forca = faixa(bruto).reduce((x, y) => x + Math.max(0, y), 0) / Math.sqrt(dur);
    momentos.push({ inicio: Math.round(inicio), fim: Math.round(fim), tipo, pico, forca, tiros: tirosT });
  }
  const maxF = Math.max(...momentos.map((m) => m.forca), 1);
  momentos.forEach((m, i) => { m.id = 'm' + (i + 1); m.nota = Math.round((m.forca / maxF) * 100); delete m.forca; });
  // escolhe os melhores ate dar ~25 min (maximo 30)
  const ALVO = 25 * 60; const MAX = 30 * 60;
  let total = 0;
  for (const m of [...momentos].sort((a, b) => b.nota - a.nota)) {
    const d = m.fim - m.inicio;
    if (total >= ALVO || total + d > MAX) { m.selecionado = false; continue; }
    m.selecionado = true;
    total += d;
  }
  // curva resumida (a cada 10 s) pro grafico
  const curva = [];
  for (let i = 0; i < n; i += 10) curva.push(Math.round(Math.max(...liso.slice(i, i + 10)) * 100) / 100);
  return { momentos, curva };
}

function hmsTexto(s) {
  s = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
}

// ---------- titulo, descricao e capitulos ----------
function sugerir(job, prefs = {}) {
  const sel = job.momentos.filter((m) => m.selecionado).sort((a, b) => a.inicio - b.inicio);
  const cont = (t) => sel.filter((m) => m.tipo === t).length;
  const f = cont('fuga'); const t = cont('tiro');
  let titulo;
  if (job.conteudo === 'react') titulo = 'MINHA REAÇÃO A ' + String(job.titulo || 'ISSO').replace(/\(\+18\)\s*/i, '').split('|')[0].trim().toLocaleUpperCase('pt-BR').slice(0, 60) + ' 😱';
  else if (f && t) titulo = 'FUGA E TROCA DE TIRO NO COMPLEXO 🔥 | GTA RP Capital';
  else if (f) titulo = (f > 1 ? 'FUGI DA POLÍCIA ' + f + ' VEZES' : 'FUGA INSANA DA POLÍCIA') + ' 🚔 | GTA RP Capital';
  else if (t) titulo = 'TROCA DE TIRO NO COMPLEXO 🔫 | GTA RP Capital';
  else titulo = 'OS MELHORES MOMENTOS DA LIVE 🔥 | GTA RP Capital';
  let pos = 0;
  const numero = {};
  const capitulos = sel.map((m) => {
    numero[m.tipo] = (numero[m.tipo] || 0) + 1;
    const linha = hmsTexto(pos) + ' ' + TIPOS[m.tipo].rotulo + (cont(m.tipo) > 1 ? ' #' + numero[m.tipo] : '');
    pos += m.fim - m.inicio;
    return linha;
  });
  const partes = [
    job.conteudo === 'react' ? 'As melhores reações da live "' + (job.titulo || '') + '".' : 'Os melhores momentos da live "' + (job.titulo || '') + '" no Capital, direto do Complexo.',
    '',
    capitulos.join('\n'),
    '',
    prefs.chamada || '',
    prefs.assinatura || '🔴 Live todo dia — twitch.tv/willscaff',
    '',
    prefs.hashtags || '#capital #complexo #cpx #gtarp #gta #willscaff',
  ];
  // contexto = so a parte do video (intro + capitulos); o Postar junta chamada/assinatura/hashtags
  const contexto = [partes[0], '', partes[2]].join('\n').trim();
  return { titulo, descricao: partes.join('\n').replace(/\n{3,}/g, '\n\n').trim(), contexto, duracao: pos };
}

const TEXTOS_THUMB = {
  fuga: [['FUGA', 'INSANA'], ['FUGI DA', 'POLÍCIA?!'], ['ELES NÃO', 'ME PEGARAM']],
  tiro: [['TROCA DE', 'TIRO'], ['TIROTEIO', 'NO COMPLEXO'], ['NINGUÉM', 'SOBREVIVEU?']],
  agito: [['DEU MUITO', 'RUIM'], ['OLHA O QUE', 'ACONTECEU'], ['NÃO ACREDITO', 'NISSO']],
  engracado: [['KKKKKK', 'NÃO AGUENTO'], ['CHOREI DE', 'RIR'], ['ISSO FOI', 'HILÁRIO']],
  conversa: [['A VERDADE', 'VEIO À TONA'], ['ACORDO', 'PERIGOSO'], ['ELE FALOU', 'DEMAIS']],
  reacao: [['MINHA REAÇÃO', 'FOI ESSA'], ['NÃO ESPERAVA', 'ISSO'], ['FIQUEI SEM', 'PALAVRAS']],
};
const ESTILOS_THUMB = [
  { cor1: '0xFFE600', cor2: 'white', caixa: '0xE11D48', tinta: [225, 29, 72], seta: '0xFFE600', lado: 'dir' },
  { cor1: 'white', cor2: '0x111111', caixa: '0xFFE600', tinta: [124, 58, 237], seta: '0xFF2E4D', lado: 'dir' },
  { cor1: '0x4ADE80', cor2: 'white', caixa: '0x7C3AED', tinta: [14, 165, 233], seta: '0xFFFFFF', lado: 'dir' },
];
const FONTE_SIMBOLO = ambiente.fonteFiltro(ambiente.fonte('simbolo'));
const FONTE_TAG = ambiente.fonteFiltro(ambiente.fonte('tag'));

// Pixels do rosto (recorte da camera) em cinza 32x32, pra medir expressao.
async function rostoCinza(arquivoJpg, cam) {
  const n = (v) => Number(v).toFixed(4);
  const partes = [];
  await rodarFfmpeg(['-hide_banner', '-nostdin', '-i', path.basename(arquivoJpg),
    '-vf', `crop=trunc(iw*${n(cam.w)}):trunc(ih*${n(cam.h)}):trunc(iw*${n(cam.x)}):trunc(ih*${n(cam.y)}),scale=32:32,format=gray`,
    '-f', 'rawvideo', 'pipe:1'], { cwd: path.dirname(arquivoJpg), aoStdout: (d) => partes.push(d) });
  return Buffer.concat(partes);
}

async function quadroEm(url, t, destino) {
  if (fs.existsSync(destino)) return destino;
  await rodarFfmpeg(['-hide_banner', '-nostdin', '-y', '-ss', String(Math.max(0, t)), '-i', url, '-frames:v', '1', '-q:v', '2', path.basename(destino)], { cwd: path.dirname(destino) });
  return destino;
}

// Cara "normal" da live: media de alguns quadros espalhados. A thumb usa o
// quadro do momento que mais foge disso (boca aberta, olho arregalado, susto).
async function rostoBase(job, url, cam) {
  const dir = pastaJob(job.id);
  const arq = path.join(dir, 'rosto-base.raw');
  if (fs.existsSync(arq)) return fs.readFileSync(arq);
  const amostras = [];
  for (let k = 1; k <= 6; k++) {
    const q = await quadroEm(url, (job.duracao * k) / 7, path.join(dir, 'base-' + k + '.jpg'));
    amostras.push(await rostoCinza(q, cam));
  }
  const base = Buffer.alloc(32 * 32);
  for (let i = 0; i < base.length; i++) base[i] = [...amostras.map((a) => a[i])].sort((a, b) => a - b)[3];
  fs.writeFileSync(arq, base);
  return base;
}

async function melhorQuadro(job, url, m, cam, base) {
  const dir = pastaJob(job.id);
  let melhor = null;
  for (const d of [-2, -1, -0.4, 0, 0.4, 1, 2]) {
    const t = Math.min(m.fim - 0.5, Math.max(m.inicio, m.pico + d));
    const q = await quadroEm(url, t, path.join(dir, 'q-' + m.id + '-' + String(d).replace('.', '_') + '.jpg'));
    const g = await rostoCinza(q, cam);
    let dif = 0; let soma = 0; let soma2 = 0;
    for (let i = 0; i < g.length; i++) { dif += Math.abs(g[i] - base[i]); soma += g[i]; soma2 += g[i] * g[i]; }
    const brilho = soma / g.length;
    const contraste = Math.sqrt(soma2 / g.length - brilho * brilho);
    // expressao (quanto foge da cara normal) + um pouco de contraste; quadro escuro perde ponto
    const nota = dif / g.length + contraste * 0.3 - (brilho < 50 ? 20 : 0);
    if (!melhor || nota > melhor.nota) melhor = { nota, arquivo: q };
  }
  return melhor.arquivo;
}

// Thumb 1280x720 no estilo YouTube: fundo com zoom na acao e cor forte,
// escurecido do lado do texto; sua cara em cartao inclinado com contorno
// branco e sombra; texto enorme inclinado; seta apontando pra voce.
async function montarThumb(job, quadro, saida, { linha1, linha2, estilo, cam }) {
  const dir = path.dirname(saida);
  const e = estilo || ESTILOS_THUMB[0];
  const t1 = String(linha1 || '').toLocaleUpperCase('pt-BR');
  const t2 = String(linha2 || '').toLocaleUpperCase('pt-BR');
  fs.writeFileSync(path.join(dir, 't1.txt'), t1, 'utf8');
  fs.writeFileSync(path.join(dir, 't2.txt'), t2, 'utf8');
  fs.writeFileSync(path.join(dir, 'tag.txt'), job.conteudo === 'react' ? 'REACT' : 'GTA RP • CAPITAL', 'utf8');
  fs.writeFileSync(path.join(dir, 'seta.txt'), '➜', 'utf8');
  const tam = (txt, max, larg) => Math.max(60, Math.min(max, Math.floor(larg / (Math.max(3, [...txt].length) * 0.72))));
  const s1 = tam(t1, 150, 700); const s2 = tam(t2, 104, 640);
  const c = cam || { x: 0.03, y: 0.6, w: 0.24, h: 0.38 };
  const n = (v) => Number(v).toFixed(4);
  // cara: miolo do recorte da camera (menos borda = rosto maior)
  const rx = c.x + c.w * 0.1; const ry = c.y + c.h * 0.02; const rw = c.w * 0.8; const rh = c.h * 0.9;
  const FH = 440; const FW = Math.round((FH * (rw * 16)) / (rh * 9) / 2) * 2; // proporcao real do recorte num 16:9
  const R = 32; const B = 11;
  // seta fica entre o texto e o cartao da cara, apontando pra voce
  const setaX = Math.max(430, 1280 - (FW + 40) - 40 - 190); const setaY = 720 - 330;
  const dist = (hw, hh, r) => `hypot(max(abs(X-${FW / 2})-${hw - r},0),max(abs(Y-${FH / 2})-${hh - r},0))-${r}`;
  const fora = dist(FW / 2, FH / 2, R);
  const dentro = dist(FW / 2 - B, FH / 2 - B, R - B);
  const [tr, tg, tb] = e.tinta;
  const filtro = [
    '[0:v]scale=1920:1080,setsar=1,split=3[a][b][c]',
    // tira a camera original do fundo e da zoom no miolo da acao
    `[b]crop=trunc(iw*${n(c.w)}):trunc(ih*${n(c.h)}):trunc(iw*${n(c.x)}):trunc(ih*${n(c.y)}),gblur=sigma=30[borr]`,
    `[a][borr]overlay=trunc(W*${n(c.x)}):trunc(H*${n(c.y)}),crop=trunc(iw*0.64):trunc(ih*0.64):trunc(iw*0.18):trunc(ih*0.12),scale=1280:720,` +
      'eq=saturation=1.6:contrast=1.2:brightness=0.02,unsharp=5:5:0.9,vignette=PI/4.2[fundo0]',
    // escurece o lado do texto e tinge a parte de baixo com a cor do estilo
    `color=c=black:s=1280x720:d=1,format=rgba,geq=r='0':g='0':b='0':a='clip(255*(0.82-X/W*1.15),0,215)'[escuro]`,
    `color=c=black:s=1280x720:d=1,format=rgba,geq=r='${tr}':g='${tg}':b='${tb}':a='clip(170*(Y/H-0.5)*2,0,150)'[tinta]`,
    '[fundo0][escuro]overlay=format=auto[fundo1]',
    '[fundo1][tinta]overlay=format=auto[fundo]',
    // cartao da cara: cantos arredondados, contorno branco, inclinado, com sombra
    `[c]crop=trunc(iw*${n(rw)}):trunc(ih*${n(rh)}):trunc(iw*${n(rx)}):trunc(ih*${n(ry)}),scale=${FW}:${FH},eq=saturation=1.25:contrast=1.12:brightness=0.03,unsharp=5:5:0.8,` +
      `format=yuva444p,geq=lum='if(gt(${dentro},0),235,lum(X,Y))':cb='if(gt(${dentro},0),128,cb(X,Y))':cr='if(gt(${dentro},0),128,cr(X,Y))':a='if(lte(${fora},0),255,0)',` +
      'format=rgba,rotate=4*PI/180:c=none:ow=rotw(4*PI/180):oh=roth(4*PI/180),split=2[cara][sombra0]',
    '[sombra0]colorchannelmixer=rr=0:rg=0:rb=0:gr=0:gg=0:gb=0:br=0:bg=0:bb=0:aa=0.65,gblur=sigma=16[sombra]',
    '[fundo][sombra]overlay=W-w-18:H-h-4:format=auto[f2]',
    '[f2][cara]overlay=W-w-36:H-h-22:format=auto[f3]',
    // texto numa camada propria, inclinado
    'color=c=black@0:s=1280x720:d=1,format=rgba,' +
      `drawtext=fontfile='${FONTE_TAG}':textfile=tag.txt:fontsize=34:fontcolor=white:box=1:boxcolor=black@0.85:boxborderw=12:x=58:y=52,` +
      `drawtext=fontfile='${fonteFiltro}':textfile=t1.txt:fontsize=${s1}:fontcolor=${e.cor1}:borderw=${Math.round(s1 / 10)}:bordercolor=black:shadowx=8:shadowy=8:shadowcolor=black@0.7:x=50:y=120,` +
      `drawtext=fontfile='${fonteFiltro}':textfile=t2.txt:fontsize=${s2}:fontcolor=${e.cor2}:box=1:boxcolor=${e.caixa}:boxborderw=20:x=70:y=${150 + s1},` +
      'rotate=-4*PI/180:c=none[texto]',
    FONTE_SIMBOLO
      ? `[f3][texto]overlay=0:0:format=auto,drawtext=fontfile='${FONTE_SIMBOLO}':textfile=seta.txt:fontsize=190:fontcolor=${e.seta}:borderw=12:bordercolor=black:x=${setaX}:y=${setaY},format=yuv420p[v]`
      : '[f3][texto]overlay=0:0:format=auto,format=yuv420p[v]',
  ].join(';');
  await rodarFfmpeg(['-hide_banner', '-nostdin', '-y', '-i', path.basename(quadro), '-filter_complex', filtro, '-map', '[v]', '-frames:v', '1', '-q:v', '2', path.basename(saida)], { cwd: dir });
}

async function gerarThumbs(job, { textos } = {}) {
  const dir = pastaJob(job.id);
  const prefs = lerPrefs();
  const cam = (prefs.layoutVertical && prefs.layoutVertical.cam) || { x: 0.03, y: 0.6, w: 0.24, h: 0.38 };
  const sel = job.momentos.filter((m) => m.selecionado).sort((a, b) => b.nota - a.nota);
  const base = sel.length ? sel : job.momentos;
  if (!base.length) throw new Error('Nenhum momento pra fazer thumbnail.');
  const url = await lives.melhorVariante(await lives.master(job.plat, job.liveId));
  job.etapa = 'aprendendo sua cara normal na live';
  const rostoNormal = await rostoBase(job, url, cam);
  const thumbs = [];
  for (let k = 0; k < 3; k++) {
    const m = base[k % base.length];
    job.etapa = 'procurando sua melhor reação no momento ' + (k + 1);
    const quadro = await melhorQuadro(job, url, m, cam, rostoNormal);
    const opcoes = TEXTOS_THUMB[m.tipo] || TEXTOS_THUMB.agito;
    const [linha1, linha2] = (textos && textos[k]) || opcoes[k % opcoes.length];
    const nome = 'thumb-' + (k + 1) + '-' + Date.now().toString(36) + '.jpg';
    job.etapa = 'desenhando a thumbnail ' + (k + 1);
    await montarThumb(job, quadro, path.join(dir, nome), { linha1, linha2, estilo: ESTILOS_THUMB[k], cam });
    thumbs.push({ arquivo: nome, momento: m.id, linha1, linha2 });
  }
  for (const t of job.thumbs || []) if (!thumbs.some((x) => x.arquivo === t.arquivo)) fs.rmSync(path.join(dir, t.arquivo), { force: true });
  job.thumbs = thumbs;
  if (!job.thumbEscolhida || !thumbs.some((t) => t.arquivo === job.thumbEscolhida)) job.thumbEscolhida = thumbs[0].arquivo;
}

// preferencias do painel (assinatura, hashtags, layout da camera)
function lerPrefs() {
  try { return JSON.parse(fs.readFileSync(path.join(cofre.DADOS, 'preferencias.json'), 'utf8')); } catch (e) { return {}; }
}

function analisar({ plat, liveId, titulo, duracao, conteudo }) {
  carregarTodos();
  const job = {
    id: Date.now().toString(36) + crypto.randomBytes(2).toString('hex'),
    plat, liveId: String(liveId), titulo: titulo || 'Live', duracao: Number(duracao) || 0, conteudo: conteudo === 'react' ? 'react' : 'rp',
    criadoEm: new Date().toISOString(), estado: 'analisando', etapa: 'abrindo a live', progresso: 0, momentos: [],
  };
  jobs.set(job.id, job);
  salvar(job);
  (async () => {
    try {
      const vs = await lives.variantes(await lives.master(plat, liveId));
      const leve = vs.filter((v) => v.altura).sort((a, b) => a.banda - b.banda)[0];
      if (!leve) throw new Error('A live nao tem versao de video disponivel.');
      const sinais = await extrairSinais(job, leve.url);
      if (!job.duracao) job.duracao = sinais.vol.length;
      job.etapa = 'procurando os momentos'; job.progresso = 96;
      const { momentos, curva } = acharMomentos(sinais, job.duracao, job.conteudo);
      job.momentos = momentos;
      job.curva = curva;
      fs.writeFileSync(path.join(pastaJob(job.id), 'sinais.json'), JSON.stringify(sinais));
      job.sugestao = sugerir(job, lerPrefs());
      job.estado = 'gerando thumbs'; job.progresso = 98;
      await gerarThumbs(job);
      job.estado = 'pronto'; job.etapa = null; job.progresso = 100;
    } catch (e) {
      job.estado = 'erro'; job.erro = e.message; job.etapa = null;
    }
    salvar(job);
  })();
  return job;
}

// ajustes vindos da tela: quais momentos entram, inicio/fim, titulo, thumb escolhida
function atualizar(id, corpo) {
  const job = obter(id);
  if (Array.isArray(corpo.momentos)) {
    for (const m of corpo.momentos) {
      const alvo = job.momentos.find((x) => x.id === m.id);
      if (!alvo) continue;
      if (typeof m.selecionado === 'boolean') alvo.selecionado = m.selecionado;
      if (Number.isFinite(m.inicio) && Number.isFinite(m.fim) && m.fim > m.inicio) { alvo.inicio = Math.max(0, m.inicio); alvo.fim = m.fim; }
      if (m.tipo && TIPOS[m.tipo]) alvo.tipo = m.tipo;
    }
    const anterior = job.sugestao || {};
    const nova = sugerir(job, lerPrefs());
    job.sugestao = { ...nova, titulo: corpo.manterTitulo && anterior.titulo ? anterior.titulo : nova.titulo };
  }
  if (typeof corpo.titulo === 'string') job.sugestao.titulo = corpo.titulo.slice(0, 100);
  if (typeof corpo.descricao === 'string') job.sugestao.descricao = corpo.descricao.slice(0, 5000);
  if (typeof corpo.thumbEscolhida === 'string' && (job.thumbs || []).some((t) => t.arquivo === corpo.thumbEscolhida)) job.thumbEscolhida = corpo.thumbEscolhida;
  salvar(job);
  return job;
}

async function refazerThumbs(id, { textos } = {}) {
  const job = obter(id);
  await gerarThumbs(job, { textos });
  job.etapa = null;
  salvar(job);
  return job;
}

// Monta o video longo com os momentos marcados, na ordem da live.
async function montar(id) {
  const job = obter(id);
  if (job.estado === 'montando') throw new Error('Ja esta montando.');
  const sel = job.momentos.filter((m) => m.selecionado).sort((a, b) => a.inicio - b.inicio);
  if (!sel.length) throw new Error('Marque pelo menos um momento.');
  const url = await lives.melhorVariante(await lives.master(job.plat, job.liveId));
  const c = clipes.importarTrecho(url, {
    trechos: sel.map((m) => ({ inicio: m.inicio, fim: m.fim })), formato: 'original',
    nome: (job.sugestao && job.sugestao.titulo) || job.titulo, origem: job.plat,
  });
  job.clipeId = c.id;
  // a thumb escolhida vira a capa do clipe (vai pro YouTube no envio)
  if (job.thumbEscolhida) require('./capa').definirImagem(c.id, path.join(pastaJob(job.id), job.thumbEscolhida));
  salvar(job);
  return { job, clipe: c };
}

// Momentos viram clipes curtos 9:16 (Shorts/Reels/TikTok) com o layout da camera.
async function virarClipes(id, ids) {
  const job = obter(id);
  const layout = lerPrefs().layoutVertical;
  const feitos = [];
  for (const mid of ids) {
    const m = job.momentos.find((x) => x.id === mid);
    if (!m) continue;
    const dur = m.fim - m.inicio;
    // Short/Reel funciona melhor curto: corta em volta do pico se passar de 90 s
    const inicio = dur > 90 ? Math.max(m.inicio, m.pico - 45) : m.inicio;
    const fim = dur > 90 ? Math.min(m.fim, inicio + 90) : m.fim;
    const c = await lives.cortar(job.plat, job.liveId, {
      trechos: [{ inicio, fim }], formato: layout ? 'vertical-layout' : 'vertical-desfocado', layout,
      nome: TIPOS[m.tipo].emoji + ' ' + TIPOS[m.tipo].rotulo + ' — ' + job.titulo.replace(/\(\+18\)\s*/i, '').slice(0, 60),
    });
    m.clipeId = c.id;
    feitos.push(c);
  }
  salvar(job);
  return feitos;
}

function arquivo(id, nome) {
  if (!/^[\w.-]+\.jpg$/.test(nome)) throw new Error('Arquivo invalido.');
  return path.join(pastaJob(id), nome);
}

function apagar(id) {
  jobs.delete(id);
  fs.rmSync(pastaJob(id), { recursive: true, force: true });
}

module.exports = { listar, obter, analisar, atualizar, refazerThumbs, montar, virarClipes, arquivo, apagar, TIPOS };
