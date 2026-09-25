// Tudo que mexe no arquivo de video: ler informacoes, converter, cortar,
// deixar vertical, gerar miniatura e baixar de link com yt-dlp.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');

function disponivel(programa) {
  try {
    const r = spawnSync(programa, ['-version'], { windowsHide: true, timeout: 15000 });
    if (r.status === 0) return true;
    const r2 = spawnSync(programa, ['--version'], { windowsHide: true, timeout: 15000 });
    return r2.status === 0;
  } catch (e) { return false; }
}

let ferramentasCache = null;
function ferramentas(recarregar) {
  if (!ferramentasCache || recarregar) {
    ferramentasCache = { ffmpeg: disponivel('ffmpeg'), ffprobe: disponivel('ffprobe'), ytdlp: disponivel('yt-dlp') };
  }
  return ferramentasCache;
}

function rodar(programa, args, { aoProgresso, duracao } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(programa, args, { windowsHide: true });
    let saida = '';
    let erro = '';
    p.stdout.on('data', (d) => {
      const t = d.toString();
      saida += t;
      if (aoProgresso && duracao) {
        const m = /out_time_ms=(\d+)/g;
        let x; let ultimo = null;
        while ((x = m.exec(t))) ultimo = x;
        if (ultimo) aoProgresso(Math.min(99, Math.round((Number(ultimo[1]) / 1e6 / duracao) * 100)));
      }
      if (saida.length > 2e6) saida = saida.slice(-1e6);
    });
    p.stderr.on('data', (d) => { erro += d.toString(); if (erro.length > 2e6) erro = erro.slice(-1e6); });
    p.on('error', (e) => reject(e.code === 'ENOENT' ? new Error(programa + ' nao esta instalado.') : e));
    p.on('close', (codigo) => {
      if (codigo === 0) resolve({ saida, erro });
      else reject(new Error(programa + ' falhou: ' + erro.trim().split(/\r?\n/).slice(-3).join(' | ')));
    });
  });
}

async function info(arquivo) {
  const { saida } = await rodar('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', arquivo]);
  const j = JSON.parse(saida);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  if (!v) throw new Error('O arquivo nao tem video.');
  let largura = v.width;
  let altura = v.height;
  const rot = Number((v.tags && v.tags.rotate) || (v.side_data_list || []).map((s) => s.rotation).find((r) => r != null) || 0);
  if (Math.abs(rot) === 90 || Math.abs(rot) === 270) [largura, altura] = [altura, largura];
  return {
    duracao: Number(j.format.duration) || Number(v.duration) || 0,
    largura, altura,
    tamanho: Number(j.format.size) || fs.statSync(arquivo).size,
    formato: j.format.format_name,
    codecVideo: v.codec_name,
    pixFmt: v.pix_fmt,
    codecAudio: a ? a.codec_name : null,
    fps: (() => { const [n, d] = String(v.avg_frame_rate || '0/1').split('/').map(Number); return d ? Math.round((n / d) * 100) / 100 : 0; })(),
  };
}

// O que todas as plataformas aceitam sem reclamar: MP4 + H.264 + AAC.
function compativel(arquivo, i) {
  return /\.mp4$/i.test(arquivo) && /mp4/.test(i.formato) && i.codecVideo === 'h264' &&
    (!i.codecAudio || i.codecAudio === 'aac') && (!i.pixFmt || i.pixFmt === 'yuv420p');
}

// So troca o "envelope" (ex.: MKV do OBS com H.264/AAC dentro) quando da, que e instantaneo.
function soRemux(i) {
  return i.codecVideo === 'h264' && (!i.codecAudio || i.codecAudio === 'aac') && (!i.pixFmt || i.pixFmt === 'yuv420p');
}

const ALVO_W = 1080;
const ALVO_H = 1920;


// Layout vertical montado no editor: recorte do jogo + (opcional) recorte da
// câmera, em faixa (em cima/embaixo) ou sobreposta com forma redonda/quadrada/
// retangular. Coordenadas do recorte vêm normalizadas (0 a 1) do vídeo original.
const CORES_BORDA = { branca: [235, 128, 128], preta: [16, 128, 128], roxa: [122, 189, 138] };
const n01 = (v, pad = 0) => Math.max(0, Math.min(1, Number(v) || pad));
const par = (v) => Math.max(2, Math.round(v / 2) * 2);

function recorte(r) {
  const x = n01(r && r.x); const y = n01(r && r.y);
  const w = Math.min(n01(r && r.w, 1), 1 - x) || 1; const h = Math.min(n01(r && r.h, 1), 1 - y) || 1;
  return `crop=w=trunc(iw*${w.toFixed(4)}/2)*2:h=trunc(ih*${h.toFixed(4)}/2)*2:x=trunc(iw*${x.toFixed(4)}):y=trunc(ih*${y.toFixed(4)})`;
}
const encaixar = (w, h) => `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;

// Máscara (e borda) de retângulo com cantos arredondados; raio = metade vira círculo.
function mascara(W, H, raio, borda, cor) {
  const cx = W / 2; const cy = H / 2;
  const dist = (hw, hh, r) => `hypot(max(abs(X-${cx})-${hw - r},0),max(abs(Y-${cy})-${hh - r},0))-${r}`;
  const fora = dist(cx, cy, raio);
  const b = borda ? Math.max(2, Math.round(W * 0.022)) : 0;
  const dentro = dist(cx - b, cy - b, Math.max(0, raio - b));
  const [cl, cb, cr] = cor || [235, 128, 128];
  const anel = (plano, valor) => (b ? `if(gt(${dentro},0),${valor},${plano}(X,Y))` : `${plano}(X,Y)`);
  return `format=yuva444p,geq=lum='${anel('lum', cl)}':cb='${anel('cb', cb)}':cr='${anel('cr', cr)}':a='if(lte(${fora},0),255,0)'`;
}

function filtroLayout(l = {}) {
  const W = ALVO_W; const H = ALVO_H;
  const modo = ['sem-camera', 'faixa-topo', 'faixa-baixo', 'sobre'].includes(l.modo) ? l.modo : 'faixa-topo';
  const cam = l.cam || { x: 0.02, y: 0.6, w: 0.26, h: 0.38 };
  // borra a câmera que já vem gravada dentro do jogo, pra não aparecer duas vezes
  const esconder = modo === 'sem-camera' ? l.esconder === true : l.esconder !== false;
  let jogo = '[jg]';
  let pre = '';
  if (esconder) {
    const x = n01(cam.x).toFixed(4); const y = n01(cam.y).toFixed(4);
    pre = `[jg0]split=2[jga][jgb];[jgb]${recorte(cam)},gblur=sigma=30[jgc];[jga][jgc]overlay=x=trunc(W*${x}):y=trunc(H*${y})[jg];`;
  } else jogo = '[jg0]';
  if (modo === 'sem-camera') {
    return { complexo: `[0:v]null[jg0];${pre}${jogo}${recorte(l.jogo)},${encaixar(W, H)},format=yuv420p[v]` };
  }
  if (modo === 'faixa-topo' || modo === 'faixa-baixo') {
    const ch = par(H * Math.max(0.2, Math.min(0.55, Number(l.proporcao) || 0.35)));
    const gh = H - ch;
    const pilha = modo === 'faixa-topo' ? '[cm][gm]' : '[gm][cm]';
    return {
      complexo: `[0:v]split=2[cm0][jg0];${pre}[cm0]${recorte(cam)},${encaixar(W, ch)}[cm];` +
        `${jogo}${recorte(l.jogo)},${encaixar(W, gh)}[gm];${pilha}vstack=inputs=2,format=yuv420p[v]`,
    };
  }
  // sobre: jogo ocupa a tela toda e a câmera fica por cima
  const forma = ['redonda', 'quadrada', 'retangular'].includes(l.forma) ? l.forma : 'redonda';
  const cw = par(W * Math.max(0.15, Math.min(0.9, Number(l.tamanho) || 0.45)));
  const chh = forma === 'retangular' ? par(cw * 9 / 16) : cw;
  const raio = forma === 'redonda' ? cw / 2 : Math.round(Math.min(cw, chh) * (forma === 'quadrada' ? 0.16 : 0.1));
  const pos = l.pos || { x: 0.5, y: 0.2 };
  const x = Math.max(0, Math.min(W - cw, Math.round(n01(pos.x, 0.5) * W - cw / 2)));
  const y = Math.max(0, Math.min(H - chh, Math.round(n01(pos.y, 0.2) * H - chh / 2)));
  const borda = l.borda && l.borda !== 'nenhuma';
  return {
    complexo: `[0:v]split=2[cm0][jg0];${pre}${jogo}${recorte(l.jogo)},${encaixar(W, H)}[fundo];` +
      `[cm0]${recorte(cam)},${encaixar(cw, chh)},${mascara(cw, chh, raio, borda, CORES_BORDA[l.borda])}[cm];` +
      `[fundo][cm]overlay=${x}:${y},format=yuv420p[v]`,
  };
}

function filtroFormato(formato, layout) {
  if (formato === 'vertical-layout') return filtroLayout(layout);
  if (formato === 'vertical-desfocado') {
    return {
      complexo: `[0:v]scale=${ALVO_W}:${ALVO_H}:force_original_aspect_ratio=increase,crop=${ALVO_W}:${ALVO_H},boxblur=25:2,eq=brightness=-0.08[fundo];` +
        `[0:v]scale=${ALVO_W}:${ALVO_H}:force_original_aspect_ratio=decrease[frente];` +
        '[fundo][frente]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]',
    };
  }
  if (formato === 'vertical-cortado') {
    return { simples: `scale=${ALVO_W}:${ALVO_H}:force_original_aspect_ratio=increase,crop=${ALVO_W}:${ALVO_H},setsar=1,format=yuv420p` };
  }
  return { simples: 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuv420p' };
}

async function converter(entrada, saida, { inicio, fim, formato = 'original', layout, remux = false, duracaoTotal, aoProgresso } = {}) {
  const args = ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:1'];
  const ini = Number(inicio) > 0 ? Number(inicio) : 0;
  const fi = Number(fim) > 0 ? Number(fim) : 0;
  if (ini) args.push('-ss', String(ini));
  if (fi) args.push('-t', String(fi - ini));
  args.push('-i', entrada);
  const duracao = (fi || duracaoTotal || 0) - ini;
  if (remux && !ini && !fi && formato === 'original') {
    args.push('-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy');
  } else {
    const f = filtroFormato(formato, layout);
    if (f.complexo) args.push('-filter_complex', f.complexo, '-map', '[v]', '-map', '0:a:0?');
    else args.push('-vf', f.simples, '-map', '0:v:0', '-map', '0:a:0?');
    // mantem o fps original; -fpsmax so derruba o que passar de 60
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high', '-fpsmax', '60');
    args.push('-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2');
  }
  args.push('-movflags', '+faststart', saida);
  await rodar('ffmpeg', args, { aoProgresso, duracao });
}


// Varios trechos do mesmo video (ex.: HLS de uma live), na ordem dada, emendados
// num clipe so. Cada trecho vira uma entrada com -ss/-t, e o concat junta tudo.
async function juntarTrechos(entrada, trechos, saida, { formato = 'original', layout, aoProgresso } = {}) {
  const args = ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:1'];
  let duracao = 0;
  for (const t of trechos) {
    const d = Number(t.fim) - Number(t.inicio);
    duracao += d;
    args.push('-ss', String(Number(t.inicio)), '-t', String(d), '-i', entrada);
  }
  const n = trechos.length;
  const partes = trechos.map((_, i) => '[' + i + ':v:0][' + i + ':a:0]').join('');
  let filtro = partes + 'concat=n=' + n + ':v=1:a=1[cv][a];';
  const f = filtroFormato(formato, layout);
  if (f.complexo) {
    // o filtro do formato pode ler a imagem mais de uma vez: divide a saida do concat
    const vezes = f.complexo.split('[0:v]').length - 1;
    let k = 0;
    filtro += vezes > 1
      ? '[cv]split=' + vezes + [...Array(vezes)].map((_, i) => '[c' + (i + 1) + ']').join('') + ';' + f.complexo.replace(/\[0:v\]/g, () => '[c' + (++k) + ']')
      : f.complexo.replace('[0:v]', '[cv]');
  } else {
    filtro += '[cv]' + f.simples + '[v]';
  }
  args.push('-filter_complex', filtro, '-map', '[v]', '-map', '[a]');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high', '-fpsmax', '60');
  args.push('-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', saida);
  await rodar('ffmpeg', args, { aoProgresso, duracao });
}

// Transicoes aceitas (nomes do filtro xfade do ffmpeg). "corte" = emenda seca.
const TRANSICOES = ['corte', 'fade', 'fadeblack', 'fadewhite', 'slideleft', 'slideup', 'smoothleft', 'zoomin', 'circleopen', 'pixelize', 'radial', 'wipeleft'];

// Encaixa qualquer video (meme, clipe de fora) no tamanho final com fundo desfocado.
function encaixeDesfocado(entrada, W, H, saida) {
  return `${entrada}split=2[${saida}f0][${saida}f1];` +
    `[${saida}f0]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=25:2,eq=brightness=-0.1[${saida}fb];` +
    `[${saida}f1]scale=${W}:${H}:force_original_aspect_ratio=decrease[${saida}ff];` +
    `[${saida}fb][${saida}ff]overlay=(W-w)/2:(H-h)/2,setsar=1`;
}

// Sequencia de itens (trechos da live e videos de fora) com transicao entre eles.
// itens: [{ entrada, inicio, fim, daLive, temAudio }], transicoes: [{ tipo, duracao }] (entre itens)
async function montarSequencia(itens, saida, { formato = 'original', layout, transicoes = [], aoProgresso } = {}) {
  const vertical = formato !== 'original';
  const W = vertical ? ALVO_W : 1920; const H = vertical ? ALVO_H : 1080;
  const args = ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:1'];
  const partes = [];
  itens.forEach((it, i) => {
    const d = Math.max(0.2, Number(it.fim) - Number(it.inicio));
    it.dur = d;
    args.push('-ss', String(Number(it.inicio)), '-t', String(d + 0.5), '-i', it.entrada);
    let v;
    if (it.daLive && vertical) {
      const f = filtroFormato(formato, layout);
      v = f.complexo
        ? f.complexo.replace(/\[0:v\]/g, () => `[${i}:v:0]`).replace(/\[v\]$/, `[p${i}r]`)
          .replace(/\[(cm0|jg0|jga|jgb|jgc|jg|cm|gm|fundo|frente)\]/g, (s, nome) => `[${nome}${i}]`)
        : `[${i}:v:0]${f.simples}[p${i}r]`;
    } else if (it.daLive) {
      v = `[${i}:v:0]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1[p${i}r]`;
    } else {
      v = encaixeDesfocado(`[${i}:v:0]`, W, H, 'e' + i) + `[p${i}r]`;
    }
    // todo mundo no mesmo ritmo e com a duracao exata (o xfade depende disso)
    partes.push(v, `[p${i}r]fps=60,format=yuv420p,tpad=stop_mode=clone:stop_duration=1,trim=duration=${d.toFixed(3)},settb=AVTB,setpts=PTS-STARTPTS[p${i}]`);
    partes.push(it.temAudio === false
      ? `aevalsrc=0:c=stereo:s=48000:d=${d.toFixed(3)}[a${i}]`
      : `[${i}:a:0]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${d.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
  });
  let v = '[p0]'; let a = '[a0]'; let total = itens[0].dur;
  for (let k = 1; k < itens.length; k++) {
    const tr = transicoes[k - 1] || {};
    const tipo = TRANSICOES.includes(tr.tipo) ? tr.tipo : 'corte';
    const T = Math.min(Number(tr.duracao) || 0.5, itens[k - 1].dur / 2, itens[k].dur / 2);
    if (tipo === 'corte' || T < 0.1) {
      partes.push(`${v}${a}[p${k}][a${k}]concat=n=2:v=1:a=1[v${k}][s${k}]`);
      total += itens[k].dur;
    } else {
      partes.push(`${v}[p${k}]xfade=transition=${tipo}:duration=${T.toFixed(3)}:offset=${(total - T).toFixed(3)}[v${k}]`);
      partes.push(`${a}[a${k}]acrossfade=d=${T.toFixed(3)}[s${k}]`);
      total += itens[k].dur - T;
    }
    v = `[v${k}]`; a = `[s${k}]`;
  }
  partes.push(v + 'format=yuv420p[vfinal]');
  args.push('-filter_complex', partes.join(';'), '-map', '[vfinal]', '-map', a);
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high');
  args.push('-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', saida);
  await rodar('ffmpeg', args, { aoProgresso, duracao: total });
  return total;
}

async function miniatura(entrada, saida, duracao) {
  const em = duracao > 3 ? Math.min(duracao / 3, 5) : 0;
  await rodar('ffmpeg', ['-y', '-hide_banner', '-ss', String(em), '-i', entrada, '-frames:v', '1',
    '-vf', 'scale=480:480:force_original_aspect_ratio=decrease', '-q:v', '4', saida]);
}

// Links que nao sao clipe da Twitch (YouTube, Kick, TikTok, VOD...) passam pelo yt-dlp.
async function baixarComYtDlp(url, saidaSemExtensao, aoProgresso) {
  if (!ferramentas().ytdlp) {
    throw new Error('Pra baixar esse tipo de link falta o yt-dlp. Instale com: winget install yt-dlp.yt-dlp e reinicie o app. (Clipe da Twitch funciona sem ele.)');
  }
  const molde = saidaSemExtensao + '.%(ext)s';
  await new Promise((resolve, reject) => {
    const p = spawn('yt-dlp', ['--no-playlist', '--newline', '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
      '--merge-output-format', 'mp4', '-o', molde, url], { windowsHide: true });
    let erro = '';
    p.stdout.on('data', (d) => {
      const m = /\[download\]\s+([\d.]+)%/.exec(d.toString());
      if (m && aoProgresso) aoProgresso(Math.round(Number(m[1])));
    });
    p.stderr.on('data', (d) => { erro += d.toString(); });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('yt-dlp: ' + (erro.trim().split(/\r?\n/).pop() || 'falhou')))));
  });
  const pasta = require('path').dirname(saidaSemExtensao);
  const base = require('path').basename(saidaSemExtensao);
  const achado = fs.readdirSync(pasta).find((n) => n.startsWith(base + '.') && !n.endsWith('.part'));
  if (!achado) throw new Error('yt-dlp terminou mas nao achei o arquivo baixado.');
  return require('path').join(pasta, achado);
}

module.exports = { ferramentas, info, compativel, soRemux, converter, juntarTrechos, montarSequencia, TRANSICOES, miniatura, baixarComYtDlp };
