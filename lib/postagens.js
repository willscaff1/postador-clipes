// Cada postagem = um clipe indo pra varias plataformas ao mesmo tempo.
// Uma plataforma falhar nao atrapalha as outras, e da pra repetir so a que falhou.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cofre = require('./cofre');
const clipes = require('./clipes');
const plataformas = require('./plataformas');
const { esconder } = require('./http');

const ARQ = path.join(cofre.DADOS, 'postagens.json');
let lista = null;
let gravacaoPendente = null;

function carregar() {
  if (lista) return lista;
  try { lista = JSON.parse(fs.readFileSync(ARQ, 'utf8')); } catch (e) { lista = []; }
  for (const p of lista) {
    for (const d of Object.values(p.destinos)) {
      if (d.estado === 'enviando' || d.estado === 'na fila') { d.estado = 'erro'; d.mensagem = 'O app foi fechado durante o envio. Confira na plataforma antes de repetir.'; }
    }
  }
  return lista;
}

function salvar(agora) {
  const gravar = () => { gravacaoPendente = null; fs.mkdirSync(cofre.DADOS, { recursive: true }); cofre.gravarAtomico(ARQ, JSON.stringify(carregar().slice(0, 500), null, 2)); };
  if (agora) { clearTimeout(gravacaoPendente); return gravar(); }
  if (!gravacaoPendente) gravacaoPendente = setTimeout(gravar, 500);
}

function listar() { return carregar(); }

function contexto(plat) {
  return { salvar: (campos) => cofre.atualizar(plat, campos) };
}

async function executar(postagem, plat) {
  const d = postagem.destinos[plat];
  const modulo = plataformas.obter(plat);
  const clipe = clipes.obter(postagem.clipeId);
  Object.assign(d, { estado: 'enviando', etapa: 'comecando', mensagem: null, aviso: null, inicio: new Date().toISOString(), log: [] });
  salvar();
  const log = (msg) => { d.etapa = msg; d.log.push({ em: new Date().toISOString(), msg }); salvar(); };
  try {
    if (!clipe || clipe.estado !== 'pronto' || !fs.existsSync(clipe.arquivo)) throw new Error('O arquivo do clipe nao existe mais.');
    // capa: o segundo escolhido vale pra todas; a imagem so pra quem aceita (YouTube/Facebook)
    const pc = postagem.capa || {};
    const arqCapa = pc.imagem ? require('./capa').arquivo(postagem.clipeId) : null;
    const capa = { segundos: Number(pc.segundos) || 0, arquivo: arqCapa && fs.existsSync(arqCapa) ? arqCapa : null };
    const r = await modulo.postar(cofre.obter(plat), { arquivo: clipe.arquivo, info: clipe.info, opcoes: d.opcoes || {}, capa }, log, contexto(plat));
    Object.assign(d, { estado: 'ok', url: r.url || null, idExterno: r.id || null, aviso: r.aviso || null, etapa: null, fim: new Date().toISOString() });
  } catch (e) {
    Object.assign(d, { estado: 'erro', mensagem: esconder(e.message), etapa: null, fim: new Date().toISOString() });
  }
  salvar(true);
}

function criar({ clipeId, destinos, capa }) {
  const clipe = clipes.obter(clipeId);
  if (!clipe) throw new Error('Escolha um clipe.');
  if (clipe.estado !== 'pronto') throw new Error('O clipe ainda nao esta pronto.');
  const escolhidos = Object.keys(destinos || {});
  if (!escolhidos.length) throw new Error('Marque pelo menos uma plataforma.');
  const resumo = Object.fromEntries(plataformas.resumo(0).map((p) => [p.id, p]));
  for (const id of escolhidos) {
    const p = resumo[id];
    if (!p || p.tipo !== 'destino') throw new Error('Plataforma desconhecida: ' + id);
    if (!p.conectado) throw new Error(p.nome + ' ainda nao esta configurado. Veja a aba Contas.');
  }
  const postagem = {
    id: Date.now().toString(36) + crypto.randomBytes(2).toString('hex'),
    criadoEm: new Date().toISOString(),
    clipeId, clipeNome: clipe.nome,
    capa: capa ? { segundos: Number(capa.segundos) || 0, imagem: !!capa.imagem } : null,
    destinos: Object.fromEntries(escolhidos.map((id) => [id, { estado: 'na fila', opcoes: destinos[id] || {} }])),
  };
  carregar().unshift(postagem);
  salvar(true);
  for (const id of escolhidos) executar(postagem, id);
  return postagem;
}

function repetir(id, plat) {
  const p = carregar().find((x) => x.id === id);
  if (!p || !p.destinos[plat]) throw new Error('Postagem nao encontrada.');
  if (p.destinos[plat].estado === 'enviando') throw new Error('Ainda esta enviando.');
  executar(p, plat);
  return p;
}

// Apaga o post publicado na propria rede (nao so do historico).
async function apagarNaRede(id, plat) {
  const p = carregar().find((x) => x.id === id);
  const d = p && p.destinos[plat];
  if (!d) throw new Error('Postagem nao encontrada.');
  if (d.estado === 'apagado') return p;
  if (d.estado !== 'ok') throw new Error('So da pra apagar o que foi publicado.');
  const modulo = plataformas.obter(plat);
  if (!modulo.apagar) {
    throw new Error(modulo.nome + ' nao deixa apagar post pela API. Apague direto no app' + (d.url ? ': ' + d.url : '.'));
  }
  if (!d.idExterno) throw new Error('Nao guardei o ID desse post; apague direto na rede' + (d.url ? ': ' + d.url : '.'));
  try {
    await modulo.apagar(cofre.obter(plat), { id: d.idExterno, url: d.url }, contexto(plat));
  } catch (e) {
    throw new Error(esconder(e.message));
  }
  Object.assign(d, { estado: 'apagado', apagadoEm: new Date().toISOString() });
  salvar(true);
  return p;
}

function apagar(id) {
  lista = carregar().filter((x) => x.id !== id);
  salvar(true);
}

// depois de receber o historico de outro painel
function recarregar() { lista = null; }

module.exports = { recarregar, listar, criar, repetir, apagar, apagarNaRede };
