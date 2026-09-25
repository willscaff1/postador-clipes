// Pacote de contas: leva as credenciais das redes (e as preferencias) de um
// painel pro outro, ex.: do PC pro Railway, sem conectar rede por rede.
// O arquivo sai criptografado (AES-256-GCM) com uma senha que voce escolhe na
// hora; sem ela o arquivo nao serve pra nada.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cofre = require('./cofre');

const ARQ_PREFS = path.join(cofre.DADOS, 'preferencias.json');
const chaveDe = (senha, sal) => crypto.scryptSync(String(senha), sal, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

function exportar(senha) {
  if (String(senha || '').length < 8) throw new Error('Escolha uma senha de pelo menos 8 caracteres pro arquivo.');
  let preferencias = {};
  try { preferencias = JSON.parse(fs.readFileSync(ARQ_PREFS, 'utf8')); } catch (e) { /* sem preferencias */ }
  const conteudo = Buffer.from(JSON.stringify({ versao: 1, criadoEm: new Date().toISOString(), contas: cofre.todas(), preferencias }), 'utf8');
  const sal = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chaveDe(senha, sal), iv);
  const dados = Buffer.concat([c.update(conteudo), c.final()]);
  return JSON.stringify({
    tipo: 'postador-contas', versao: 1, sal: sal.toString('base64'), iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'), dados: dados.toString('base64'),
  });
}

function importar(texto, senha) {
  let p;
  try { p = JSON.parse(texto); } catch (e) { throw new Error('Esse arquivo nao e um pacote de contas do postador.'); }
  if (!p || p.tipo !== 'postador-contas') throw new Error('Esse arquivo nao e um pacote de contas do postador.');
  let conteudo;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', chaveDe(senha, Buffer.from(p.sal, 'base64')), Buffer.from(p.iv, 'base64'));
    d.setAuthTag(Buffer.from(p.tag, 'base64'));
    conteudo = JSON.parse(Buffer.concat([d.update(Buffer.from(p.dados, 'base64')), d.final()]).toString('utf8'));
  } catch (e) { throw new Error('Senha do arquivo errada (ou arquivo corrompido).'); }
  const redes = [];
  for (const [plat, campos] of Object.entries(conteudo.contas || {})) {
    if (!campos || typeof campos !== 'object' || !Object.keys(campos).length) continue;
    cofre.substituir(plat, campos);
    redes.push(plat);
  }
  if (conteudo.preferencias && typeof conteudo.preferencias === 'object') {
    let atuais = {};
    try { atuais = JSON.parse(fs.readFileSync(ARQ_PREFS, 'utf8')); } catch (e) { /* nada */ }
    cofre.gravarAtomico(ARQ_PREFS, JSON.stringify({ ...atuais, ...conteudo.preferencias }, null, 2));
  }
  return { redes, exportadoEm: conteudo.criadoEm };
}

module.exports = { exportar, importar };
