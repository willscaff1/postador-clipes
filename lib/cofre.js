// Guarda as credenciais das contas criptografadas no disco.
//
// O arquivo dados/contas.cofre e AES-256-GCM; a chave fica em dados/chave.bin,
// dentro da sua pasta de usuario (que o Windows ja fecha pros outros usuarios).
// Isso impede que um token vaze por print, git ou copia do arquivo sozinho.
// Nao protege contra alguem com acesso ao seu usuario logado.
//
// Nao usar DPAPI via powershell.exe aqui: o Kaspersky da maquina trata
// "node abrindo powershell pra mexer em credencial" como ataque, mata o
// processo e manda o server.js pra quarentena (visto em 24/09/2026).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { DADOS } = require('./ambiente');
const ARQ_CHAVE = path.join(DADOS, 'chave.bin');
const ARQ_COFRE = path.join(DADOS, 'contas.cofre');
const ARQ_STATUS = path.join(DADOS, 'status-contas.json');

let chave = null;
let contas = null;

function obterChave() {
  if (chave) return chave;
  fs.mkdirSync(DADOS, { recursive: true });
  if (fs.existsSync(ARQ_CHAVE)) {
    chave = fs.readFileSync(ARQ_CHAVE);
  } else {
    chave = crypto.randomBytes(32);
    fs.writeFileSync(ARQ_CHAVE, chave, { mode: 0o600 });
  }
  return chave;
}

function gravarAtomico(arquivo, conteudo) {
  const tmp = arquivo + '.tmp';
  fs.writeFileSync(tmp, conteudo);
  fs.renameSync(tmp, arquivo);
}

function carregar() {
  if (contas) return contas;
  if (!fs.existsSync(ARQ_COFRE)) return (contas = {});
  const { iv, tag, dados } = JSON.parse(fs.readFileSync(ARQ_COFRE, 'utf8'));
  const d = crypto.createDecipheriv('aes-256-gcm', obterChave(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  const texto = Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8');
  return (contas = JSON.parse(texto));
}

function persistir() {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', obterChave(), iv);
  const dados = Buffer.concat([c.update(JSON.stringify(contas), 'utf8'), c.final()]);
  gravarAtomico(ARQ_COFRE, JSON.stringify({
    iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), dados: dados.toString('base64'),
  }));
}

function obter(plataforma) {
  return { ...(carregar()[plataforma] || {}) };
}

// Campo vazio nao apaga o que ja estava salvo (a tela nunca recebe segredo de volta).
// Pra apagar um campo de proposito, mande null.
function atualizar(plataforma, campos) {
  const todas = carregar();
  const atual = { ...(todas[plataforma] || {}) };
  for (const [k, v] of Object.entries(campos || {})) {
    if (v === null) delete atual[k];
    else if (typeof v === 'string' && v.trim() === '') continue;
    else atual[k] = typeof v === 'string' ? v.trim() : v;
  }
  todas[plataforma] = atual;
  persistir();
  return { ...atual };
}

function remover(plataforma) {
  const todas = carregar();
  delete todas[plataforma];
  persistir();
  const st = lerStatus();
  delete st[plataforma];
  gravarAtomico(ARQ_STATUS, JSON.stringify(st, null, 2));
}

// Tudo que parece segredo, pra ser apagado de mensagens de erro e registros.
function segredos() {
  const lista = [];
  for (const conta of Object.values(carregar())) {
    for (const v of Object.values(conta)) {
      if (typeof v === 'string' && v.length >= 10) lista.push(v);
    }
  }
  return lista;
}

// Resultado do ultimo teste de cada conta (nada secreto aqui).
function lerStatus() {
  try { return JSON.parse(fs.readFileSync(ARQ_STATUS, 'utf8')); } catch (e) { return {}; }
}

function gravarStatus(plataforma, status) {
  const st = lerStatus();
  st[plataforma] = { ...status, quando: new Date().toISOString() };
  fs.mkdirSync(DADOS, { recursive: true });
  gravarAtomico(ARQ_STATUS, JSON.stringify(st, null, 2));
  return st[plataforma];
}

module.exports = { obter, atualizar, remover, segredos, lerStatus, gravarStatus, carregar, DADOS, gravarAtomico };
