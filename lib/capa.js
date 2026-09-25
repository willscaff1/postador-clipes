// Capa do clipe: um quadro do video (opcionalmente com texto grande por cima)
// ou uma imagem enviada do PC. Fica em dados/capas/<clipe>.jpg.
//
// Cada rede usa como pode: YouTube e Facebook aceitam a imagem; Instagram e
// TikTok so aceitam escolher o quadro (o segundo do video).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DADOS, gravarAtomico } = require('./cofre');

const PASTA = path.join(DADOS, 'capas');
// Fonte grossa pra capa; cai pra Arial Negrito se a Arial Black nao existir.
const FONTES = ['C:/Windows/Fonts/ariblk.ttf', 'C:/Windows/Fonts/arialbd.ttf'];

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { cwd: PASTA, windowsHide: true });
    let erro = '';
    p.stderr.on('data', (d) => { erro += d.toString(); if (erro.length > 2e5) erro = erro.slice(-1e5); });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg: ' + erro.trim().split(/\r?\n/).slice(-2).join(' | ')))));
  });
}

function arquivo(clipeId) { return path.join(PASTA, clipeId + '.jpg'); }
function infoArquivo(clipeId) { return path.join(PASTA, clipeId + '.json'); }

function ler(clipeId) {
  try { return { ...JSON.parse(fs.readFileSync(infoArquivo(clipeId), 'utf8')), arquivo: arquivo(clipeId) }; } catch (e) { return null; }
}

// Quebra o texto em linhas curtas pra caber grande na tela.
function quebrar(texto, porLinha) {
  const palavras = String(texto).trim().toLocaleUpperCase('pt-BR').split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = '';
  for (const p of palavras) {
    if ((atual + ' ' + p).trim().length > porLinha && atual) { linhas.push(atual); atual = p; } else atual = (atual + ' ' + p).trim();
  }
  if (atual) linhas.push(atual);
  return linhas.slice(0, 4).join('\n');
}

// O filtro do ffmpeg precisa de "C\:" no caminho da fonte.
const caminhoFiltro = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:');

async function gerar(clipe, { segundos = 1, texto = '', cor = 'amarelo', posicao = 'meio' } = {}) {
  fs.mkdirSync(PASTA, { recursive: true });
  const info = clipe.info || {};
  const t = Math.max(0, Math.min(Number(segundos) || 0, Math.max(0, (info.duracao || 1) - 0.1)));
  const vertical = info.altura > info.largura;
  const [W, H] = vertical ? [1080, 1920] : [1280, 720];
  const filtros = [`scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`];
  const txt = String(texto || '').trim();
  if (txt) {
    const nomeTexto = clipe.id + '-texto.txt';
    fs.writeFileSync(path.join(PASTA, nomeTexto), quebrar(txt, vertical ? 14 : 22), 'utf8');
    const fonte = FONTES.find((f) => fs.existsSync(f)) || FONTES[1];
    const tamanho = Math.round(vertical ? W * 0.105 : H * 0.13);
    const corHex = { amarelo: '0xFFE600', branco: 'white', verde: '0x33FF66' }[cor] || '0xFFE600';
    const y = { topo: 'h*0.12', meio: '(h-text_h)/2', baixo: 'h*0.88-text_h' }[posicao] || 'h*0.12';
    filtros.push(`drawtext=fontfile='${caminhoFiltro(fonte)}':textfile=${nomeTexto}:fontsize=${tamanho}:fontcolor=${corHex}` +
      `:borderw=${Math.round(tamanho / 9)}:bordercolor=black:line_spacing=${Math.round(tamanho * 0.15)}:x=(w-text_w)/2:y=${y}:text_align=C`);
  }
  await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', path.resolve(clipe.arquivo),
    '-frames:v', '1', '-vf', filtros.join(','), '-q:v', '3', path.basename(arquivo(clipe.id))]);
  fs.rmSync(path.join(PASTA, clipe.id + '-texto.txt'), { force: true });
  const dados = { segundos: t, texto: txt, cor, posicao, personalizada: !!txt, enviada: false, em: Date.now() };
  gravarAtomico(infoArquivo(clipe.id), JSON.stringify(dados));
  return dados;
}

// Imagem enviada do PC: normaliza pra JPG leve (YouTube aceita ate 2 MB).
async function receberImagem(clipe, req, nome) {
  fs.mkdirSync(PASTA, { recursive: true });
  const ext = (path.extname(nome || '') || '.png').toLowerCase();
  if (!/^\.(png|jpe?g|webp)$/.test(ext)) throw new Error('Envie PNG, JPG ou WEBP.');
  const bruto = path.join(PASTA, clipe.id + '-envio' + ext);
  await new Promise((resolve, reject) => {
    const s = fs.createWriteStream(bruto);
    req.pipe(s);
    s.on('finish', resolve);
    s.on('error', reject);
    req.on('aborted', () => reject(new Error('Envio cancelado.')));
  });
  const vertical = (clipe.info || {}).altura > (clipe.info || {}).largura;
  const [W, H] = vertical ? [1080, 1920] : [1280, 720];
  try {
    await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', path.basename(bruto),
      '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`, '-q:v', '3', path.basename(arquivo(clipe.id))]);
  } finally {
    fs.rmSync(bruto, { force: true });
  }
  const anterior = ler(clipe.id) || {};
  const dados = { segundos: anterior.segundos || 1, texto: '', personalizada: true, enviada: true, em: Date.now() };
  gravarAtomico(infoArquivo(clipe.id), JSON.stringify(dados));
  return dados;
}

// Imagem pronta (ex.: thumbnail do Estudio) vira a capa do clipe.
function definirImagem(clipeId, origem) {
  fs.mkdirSync(PASTA, { recursive: true });
  fs.copyFileSync(origem, arquivo(clipeId));
  const dados = { segundos: 1, texto: '', personalizada: true, enviada: true, em: Date.now() };
  gravarAtomico(infoArquivo(clipeId), JSON.stringify(dados));
  return dados;
}

function remover(clipeId) {
  fs.rmSync(arquivo(clipeId), { force: true });
  fs.rmSync(infoArquivo(clipeId), { force: true });
}

module.exports = { gerar, receberImagem, definirImagem, ler, arquivo, remover };
