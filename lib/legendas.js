// Legenda automatica "estilo TikTok": o Whisper (embutido no ffmpeg) ouve o
// clipe, o texto e quebrado em pedacos de poucas palavras e queimado no video
// com letra grande, contorno preto e destaque.
//
// Roda 100% offline. Precisa so do arquivo do modelo em dados/modelos/.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DADOS } = require('./cofre');

const PASTA_MODELOS = path.join(DADOS, 'modelos');
const MODELOS = ['ggml-medium.bin', 'ggml-small.bin', 'ggml-base.bin'];

function modelo() {
  for (const m of MODELOS) {
    const p = path.join(PASTA_MODELOS, m);
    if (fs.existsSync(p) && fs.statSync(p).size > 10 * 1024 * 1024) return m;
  }
  return null;
}

function disponivel() { return !!modelo(); }

// Os filtros do ffmpeg nao gostam de "C:\" no meio das opcoes. Por isso tudo
// roda com a pasta de trabalho certa e caminhos relativos simples.
function ffmpeg(args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { cwd, windowsHide: true });
    let erro = '';
    p.stderr.on('data', (d) => { erro += d.toString(); if (erro.length > 1e6) erro = erro.slice(-5e5); });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg: ' + erro.trim().split(/\r?\n/).slice(-3).join(' | ')))));
  });
}

function tempoSrt(t) {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000 : 0;
}

function lerSrt(texto) {
  const blocos = texto.replace(/\r/g, '').split(/\n\n+/);
  const saida = [];
  for (const b of blocos) {
    const linhas = b.split('\n').filter(Boolean);
    const i = linhas.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = linhas[i].split('-->').map((s) => tempoSrt(s.trim()));
    const frase = linhas.slice(i + 1).join(' ').replace(/\[.*?\]|\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
    if (frase && z > a) saida.push({ ini: a, fim: z, texto: frase });
  }
  return saida;
}

async function transcrever(arquivo) {
  const m = modelo();
  if (!m) throw new Error('Modelo de legenda nao instalado.');
  const nome = 'transcricao-' + Date.now() + '.srt';
  const destino = path.join(PASTA_MODELOS, nome);
  // queue maior = frases mais inteiras; vad corta silencio antes de mandar pro modelo
  await ffmpeg(['-y', '-hide_banner', '-i', path.resolve(arquivo), '-vn',
    '-af', `whisper=model=${m}:language=pt:queue=10:destination=${nome}:format=srt`, '-f', 'null', '-'], PASTA_MODELOS);
  const texto = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8') : '';
  fs.rmSync(destino, { force: true });
  return lerSrt(texto);
}

// Quebra cada frase em pedacos de ate N palavras, dividindo o tempo pelo
// tamanho do texto (fala mais longa fica mais tempo na tela).
function picotar(frases, porVez = 3) {
  const saida = [];
  for (const f of frases) {
    const palavras = f.texto.split(' ');
    const grupos = [];
    for (let i = 0; i < palavras.length; i += porVez) grupos.push(palavras.slice(i, i + porVez).join(' '));
    const total = grupos.reduce((n, g) => n + g.length, 0) || 1;
    let t = f.ini;
    for (const g of grupos) {
      const dur = ((f.fim - f.ini) * g.length) / total;
      saida.push({ ini: t, fim: t + dur, texto: g });
      t += dur;
    }
  }
  return saida;
}

function tempoAss(t) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${s}`;
}

const ESTILOS = {
  // cor ASS e &HAABBGGRR
  amarelo: '&H0000F2FF',
  branco: '&H00FFFFFF',
  verde: '&H0066FF33',
};

function montarAss(pedacos, { largura, altura, estilo = 'amarelo', posicao = 'meio' }) {
  const fonte = Math.round(altura * (largura < altura ? 0.058 : 0.075));
  // "meio" fica logo abaixo da camera no layout vertical da Twitch; "baixo" acima da barra do app
  const margem = Math.round(altura * (posicao === 'baixo' ? 0.2 : 0.4));
  const cor = ESTILOS[estilo] || ESTILOS.amarelo;
  const cab = `[Script Info]
ScriptType: v4.00+
PlayResX: ${largura}
PlayResY: ${altura}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Corte,Arial Black,${fonte},${cor},&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,${Math.max(3, Math.round(fonte / 9))},2,2,40,40,${margem},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const limpa = (s) => s.replace(/[{}\\]/g, '').toLocaleUpperCase('pt-BR');
  // leve "pulo" de entrada em cada pedaco, como nas legendas de corte
  const linhas = pedacos.map((p) => `Dialogue: 0,${tempoAss(p.ini)},${tempoAss(p.fim)},Corte,,0,0,0,,{\\fscx115\\fscy115\\t(0,90,\\fscx100\\fscy100)}${limpa(p.texto)}`);
  return cab + linhas.join('\n') + '\n';
}

// Transcreve e queima a legenda. Devolve quantas frases achou (0 = sem fala).
async function legendar(entrada, saida, info, opcoes = {}) {
  const frases = await transcrever(entrada);
  if (!frases.length) {
    fs.copyFileSync(entrada, saida);
    return 0;
  }
  const ass = montarAss(picotar(frases, opcoes.porVez || 3), { largura: info.largura, altura: info.altura, estilo: opcoes.estilo, posicao: opcoes.posicao });
  const nome = 'legenda-' + Date.now() + '.ass';
  fs.writeFileSync(path.join(PASTA_MODELOS, nome), ass, 'utf8');
  try {
    await ffmpeg(['-y', '-hide_banner', '-i', path.resolve(entrada), '-vf', `ass=${nome},format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'copy', '-movflags', '+faststart', path.resolve(saida)], PASTA_MODELOS);
  } finally {
    fs.rmSync(path.join(PASTA_MODELOS, nome), { force: true });
  }
  return frases.length;
}

module.exports = { disponivel, modelo, transcrever, legendar, PASTA_MODELOS, lerSrt, picotar, montarAss };
