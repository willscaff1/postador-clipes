// Biblioteca de clipes: tudo que entra (do PC, da Twitch, de link) vira um
// MP4 H.264/AAC pronto pra qualquer plataforma, com miniatura.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pedir } = require('./http');
const { DADOS, gravarAtomico } = require('./cofre');
const midia = require('./midia');
const twitch = require('./plataformas/twitch');
const legendas = require('./legendas');

const PASTA = path.join(DADOS, 'clipes');
const ARQ = path.join(DADOS, 'clipes.json');
const EXTENSOES = /\.(mp4|mov|mkv|webm|m4v|avi|flv|ts)$/i;

let lista = null;

function carregar() {
  if (lista) return lista;
  try { lista = JSON.parse(fs.readFileSync(ARQ, 'utf8')); } catch (e) { lista = []; }
  // o que estava sendo processado quando o app fechou nao vai terminar sozinho
  for (const c of lista) if (c.estado === 'processando') { c.estado = 'erro'; c.erro = 'O app foi fechado no meio do processamento.'; }
  return lista;
}

function salvar() {
  fs.mkdirSync(PASTA, { recursive: true });
  gravarAtomico(ARQ, JSON.stringify(carregar(), null, 2));
}

function novoId() { return Date.now().toString(36) + crypto.randomBytes(3).toString('hex'); }

function obter(id) { return carregar().find((c) => c.id === id) || null; }

function listar() { return carregar().slice().sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)); }

function nomeLimpo(n) { return String(n || 'clipe').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) || 'clipe'; }

function criar(dados) {
  const c = { id: novoId(), criadoEm: new Date().toISOString(), estado: 'processando', progresso: 0, ...dados };
  carregar().push(c);
  salvar();
  return c;
}

function atualizar(c, campos) {
  Object.assign(c, campos);
  salvar();
}

// Deixa o arquivo pronto: so aponta (se ja for compativel), troca o envelope
// ou converte. `temporario` = arquivo nosso que pode ser apagado/movido.
async function finalizar(c, origem, { temporario }) {
  try {
    const i = await midia.info(origem);
    const destino = path.join(PASTA, c.id + '.mp4');
    if (midia.compativel(origem, i)) {
      if (temporario) { fs.renameSync(origem, destino); c.arquivo = destino; } else { c.arquivo = origem; c.externo = true; }
    } else {
      atualizar(c, { etapa: midia.soRemux(i) ? 'ajustando o formato' : 'convertendo pra MP4' });
      await midia.converter(origem, destino, {
        remux: midia.soRemux(i), duracaoTotal: i.duracao,
        aoProgresso: (p) => { c.progresso = p; },
      });
      if (temporario) fs.rmSync(origem, { force: true });
      c.arquivo = destino;
    }
    c.info = await midia.info(c.arquivo);
    const mini = path.join(PASTA, c.id + '.jpg');
    await midia.miniatura(c.arquivo, mini, c.info.duracao).then(() => { c.miniatura = mini; }).catch(() => {});
    atualizar(c, { estado: 'pronto', progresso: 100, etapa: null });
  } catch (e) {
    if (temporario) fs.rmSync(origem, { force: true });
    atualizar(c, { estado: 'erro', erro: e.message, etapa: null });
  }
}

function tmp(ext = '.bin') {
  fs.mkdirSync(PASTA, { recursive: true });
  return path.join(PASTA, 'tmp-' + novoId() + ext);
}

// Upload pelo navegador: o corpo da requisicao e o proprio arquivo.
function receberUpload(req, nome) {
  const ext = (path.extname(nome || '') || '.mp4').toLowerCase();
  if (!EXTENSOES.test(ext)) throw new Error('Formato nao suportado: ' + ext);
  const arquivo = tmp(ext);
  return new Promise((resolve, reject) => {
    const saida = fs.createWriteStream(arquivo);
    req.pipe(saida);
    req.on('aborted', () => { saida.destroy(); fs.rmSync(arquivo, { force: true }); reject(new Error('Envio cancelado.')); });
    saida.on('error', reject);
    saida.on('finish', () => {
      const c = criar({ nome: nomeLimpo(nome), origem: 'pc', etapa: 'lendo o video' });
      finalizar(c, arquivo, { temporario: true });
      resolve(c);
    });
  });
}

// Arquivo que ja esta no PC: nao copia se nao precisar.
function importarCaminho(caminho) {
  const alvo = path.resolve(String(caminho || '').replace(/^"|"$/g, ''));
  if (!fs.existsSync(alvo) || !fs.statSync(alvo).isFile()) throw new Error('Arquivo nao encontrado: ' + alvo);
  if (!EXTENSOES.test(alvo)) throw new Error('Isso nao parece um video: ' + path.basename(alvo));
  const c = criar({ nome: nomeLimpo(path.basename(alvo)), origem: 'pc', caminhoOriginal: alvo, etapa: 'lendo o video' });
  finalizar(c, alvo, { temporario: false });
  return c;
}

function listarPasta(pasta) {
  const alvo = path.resolve(pasta || path.join(process.env.USERPROFILE || '.', 'Videos'));
  if (!fs.existsSync(alvo)) throw new Error('Pasta nao encontrada: ' + alvo);
  const itens = [];
  for (const nome of fs.readdirSync(alvo)) {
    let st;
    try { st = fs.statSync(path.join(alvo, nome)); } catch (e) { continue; }
    if (st.isDirectory()) { if (!nome.startsWith('.')) itens.push({ nome, pasta: true }); }
    else if (EXTENSOES.test(nome)) itens.push({ nome, tamanho: st.size, modificado: st.mtime.toISOString() });
  }
  itens.sort((a, b) => (a.pasta === b.pasta ? (a.pasta ? a.nome.localeCompare(b.nome) : b.modificado.localeCompare(a.modificado)) : a.pasta ? -1 : 1));
  return { pasta: alvo, acima: path.dirname(alvo) !== alvo ? path.dirname(alvo) : null, itens };
}

async function baixarArquivo(url, destino, aoProgresso) {
  const res = await fetch(url, { signal: AbortSignal.timeout(1800000) });
  if (!res.ok) throw new Error('Download respondeu ' + res.status);
  const total = Number(res.headers.get('content-length')) || 0;
  const saida = fs.createWriteStream(destino);
  let baixado = 0;
  for await (const pedaco of res.body) {
    baixado += pedaco.length;
    if (total && aoProgresso) aoProgresso(Math.round((baixado / total) * 100));
    if (!saida.write(pedaco)) await new Promise((r) => saida.once('drain', r));
  }
  await new Promise((r, j) => saida.end((e) => (e ? j(e) : r())));
}

// Clipe da Twitch vai direto; qualquer outro link passa pelo yt-dlp.
function importarLink(url, nomeSugerido, { vertical = true, esperar = 0 } = {}) {
  const link = String(url || '').trim();
  if (!/^https?:\/\//i.test(link)) throw new Error('Cole um link comecando com http.');
  const slug = twitch.slugDoLink(link);
  const c = criar({ nome: nomeLimpo(nomeSugerido || (slug ? 'Clipe Twitch' : 'Video do link')), origem: slug ? 'twitch' : 'link', link, etapa: 'baixando' });
  (async () => {
    try {
      let arquivo;
      if (slug) {
        // clipe recem-criado demora uns segundos pra ficar disponivel
        let info;
        for (let t = 0; ; t++) {
          try { info = await twitch.linkDoClipe(slug, { vertical }); break; } catch (e) {
            if (!esperar || t >= 8) throw e;
            atualizar(c, { etapa: 'esperando a Twitch processar o clipe' });
            await new Promise((r) => setTimeout(r, esperar / 4));
          }
        }
        if (!nomeSugerido && info.titulo) c.nome = nomeLimpo(info.titulo);
        c.canal = info.canal;
        atualizar(c, { etapa: 'baixando da Twitch (' + info.qualidade + ')' });
        arquivo = tmp('.mp4');
        await baixarArquivo(info.url, arquivo, (p) => { c.progresso = p; });
      } else {
        arquivo = await midia.baixarComYtDlp(link, tmp('').replace(/\.?$/, ''), (p) => { c.progresso = p; });
      }
      atualizar(c, { etapa: 'lendo o video', progresso: 0 });
      await finalizar(c, arquivo, { temporario: true });
    } catch (e) {
      atualizar(c, { estado: 'erro', erro: e.message, etapa: null });
    }
  })();
  return c;
}

// Trecho de uma live gravada (HLS da Twitch/Kick): o ffmpeg baixa so o pedaco.
function importarTrecho(url, { inicio, fim, trechos, formato = 'original', layout, nome, origem }) {
  const c = criar({ nome: nomeLimpo(nome), origem, etapa: 'baixando o trecho da live' });
  (async () => {
    try {
      const arquivo = tmp('.mp4');
      const aoProgresso = (p) => { c.progresso = p; };
      if (trechos && trechos.length > 1) {
        atualizar(c, { etapa: 'baixando e emendando ' + trechos.length + ' trechos' });
        await midia.juntarTrechos(url, trechos, arquivo, { formato, layout, aoProgresso });
      } else {
        const t = trechos && trechos[0] ? trechos[0] : { inicio, fim };
        await midia.converter(url, arquivo, { inicio: t.inicio, fim: t.fim, formato, layout, aoProgresso });
      }
      atualizar(c, { etapa: 'lendo o video', progresso: 0 });
      await finalizar(c, arquivo, { temporario: true });
    } catch (e) {
      atualizar(c, { estado: 'erro', erro: e.message, etapa: null });
    }
  })();
  return c;
}

// Sequencia montada no editor: trechos da live + videos de fora (memes), com transicao.
function importarSequencia(itens, { transicoes, formato = 'original', layout, nome, origem }) {
  const c = criar({ nome: nomeLimpo(nome), origem, etapa: 'montando a sequencia (' + itens.length + ' partes)' });
  (async () => {
    const arquivo = tmp('.mp4');
    try {
      await midia.montarSequencia(itens, arquivo, { formato, layout, transicoes, aoProgresso: (p) => { c.progresso = p; } });
      atualizar(c, { etapa: 'lendo o video', progresso: 0 });
      await finalizar(c, arquivo, { temporario: true });
    } catch (e) {
      fs.rmSync(arquivo, { force: true });
      atualizar(c, { estado: 'erro', erro: e.message, etapa: null });
    }
  })();
  return c;
}

// Corta um trecho e/ou deixa vertical: vira um clipe NOVO, o original fica.
function preparar(id, { inicio, fim, formato, layout, nome, legendas: comLegenda, estiloLegenda, posicaoLegenda }) {
  const base = obter(id);
  if (!base || base.estado !== 'pronto') throw new Error('Clipe nao esta pronto.');
  const ini = Math.max(0, Number(inicio) || 0);
  const fi = Number(fim) || 0;
  if (fi && fi <= ini) throw new Error('O fim precisa ser depois do inicio.');
  if (comLegenda && !legendas.disponivel()) throw new Error('A legenda automatica ainda nao esta instalada (falta o modelo de voz).');
  const soLegenda = comLegenda && (!formato || formato === 'original') && !ini && !fi;
  const sufixo = soLegenda ? ' (legendado)'
    : (formato === 'vertical-desfocado' ? ' (vertical)' : formato === 'vertical-cortado' ? ' (vertical cortado)' : formato === 'vertical-layout' ? ' (vertical com camera)' : ' (trecho)') + (comLegenda ? ' (legendado)' : '');
  const c = criar({ nome: nomeLimpo(nome || base.nome + sufixo), origem: 'preparado', baseId: base.id, etapa: soLegenda ? 'ouvindo o audio' : 'renderizando' });
  (async () => {
    const saida = tmp('.mp4');
    const legendado = tmp('.mp4');
    try {
      let atual = base.arquivo;
      if (!soLegenda) {
        await midia.converter(base.arquivo, saida, {
          inicio: ini, fim: fi, formato, layout, duracaoTotal: base.info.duracao,
          aoProgresso: (p) => { c.progresso = p; },
        });
        atual = saida;
      }
      if (comLegenda) {
        atualizar(c, { etapa: 'ouvindo o audio e escrevendo a legenda', progresso: 0 });
        const frases = await legendas.legendar(atual, legendado, await midia.info(atual), { estilo: estiloLegenda, posicao: posicaoLegenda });
        if (!frases) c.aviso = 'Nao achei fala no clipe; saiu sem legenda.';
        if (atual === saida) fs.rmSync(saida, { force: true });
        atual = legendado;
      }
      await finalizar(c, atual, { temporario: true });
    } catch (e) {
      fs.rmSync(saida, { force: true });
      fs.rmSync(legendado, { force: true });
      atualizar(c, { estado: 'erro', erro: e.message, etapa: null });
    }
  })();
  return c;
}

function renomear(id, nome) {
  const c = obter(id);
  if (!c) throw new Error('Clipe nao encontrado.');
  atualizar(c, { nome: nomeLimpo(nome) });
  return c;
}

// Apaga so o que e nosso; arquivo que ja estava no PC fica intacto.
function remover(id) {
  const c = obter(id);
  if (!c) return;
  if (c.arquivo && !c.externo && c.arquivo.startsWith(PASTA)) fs.rmSync(c.arquivo, { force: true });
  if (c.miniatura) fs.rmSync(c.miniatura, { force: true });
  require('./capa').remover(id);
  lista = carregar().filter((x) => x.id !== id);
  salvar();
}

// Limpa sobras de envio que nao terminaram.
function limparTemporarios() {
  if (!fs.existsSync(PASTA)) return;
  for (const n of fs.readdirSync(PASTA)) if (n.startsWith('tmp-')) fs.rmSync(path.join(PASTA, n), { force: true });
}

module.exports = { listar, obter, receberUpload, importarCaminho, listarPasta, importarLink, importarTrecho, importarSequencia, preparar, renomear, remover, limparTemporarios };
