// Chamadas HTTP pras APIs, com duas garantias:
//  - erro vira mensagem legivel ("YouTube respondeu 403: ...")
//  - nenhum token aparece em erro, registro ou tela
const fs = require('fs');
const path = require('path');

function esconder(texto) {
  let t = String(texto == null ? '' : texto);
  try {
    for (const s of require('./cofre').segredos()) t = t.split(s).join('<escondido>');
  } catch (e) { /* cofre ainda nao carregou */ }
  return t
    .replace(/((?:access_token|refresh_token|client_secret|token|sig)=)[^&\s"']+/gi, '$1<escondido>')
    .replace(/(Bearer|OAuth)\s+[A-Za-z0-9._\-|%]+/g, '$1 <escondido>');
}

function extrairErro(dados, texto) {
  if (dados && typeof dados === 'object') {
    const e = dados.error;
    if (e && typeof e === 'object') {
      return [e.error_user_title, e.error_user_msg || e.message, e.code && e.code !== 'ok' ? '(' + e.code + ')' : '']
        .filter(Boolean).join(' ');
    }
    if (dados.error_description) return dados.error_description;
    if (typeof e === 'string') return e;
    if (dados.errors && dados.errors[0]) {
      const x = dados.errors[0];
      return x.message || x.detail || JSON.stringify(x);
    }
    if (dados.detail) return (dados.title ? dados.title + ': ' : '') + dados.detail;
    if (dados.message) return dados.message;
  }
  return String(texto || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
}

class ErroApi extends Error {
  constructor(rotulo, status, detalhe, dados) {
    super(esconder((rotulo || 'Servico') + ' respondeu ' + status + ': ' + (detalhe || 'sem detalhe')));
    this.status = status;
    this.dados = dados;
  }
}

async function pedir(url, opcoes = {}) {
  const { method = 'GET', headers = {}, json, form, body, rotulo = 'Servico', timeout = 120000, aceitar } = opcoes;
  const h = { ...headers };
  let corpo = body;
  if (json !== undefined) { h['Content-Type'] = 'application/json; charset=UTF-8'; corpo = JSON.stringify(json); }
  if (form !== undefined) { h['Content-Type'] = 'application/x-www-form-urlencoded'; corpo = new URLSearchParams(form).toString(); }
  let res;
  try {
    res = await fetch(url, { method, headers: h, body: corpo, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
  } catch (e) {
    const causa = e.cause && (e.cause.code || e.cause.message);
    const msg = e.name === 'TimeoutError' ? 'demorou demais pra responder' : (causa || e.message);
    throw new Error(esconder(rotulo + ': falha de rede (' + msg + ')'));
  }
  const texto = await res.text();
  let dados = texto;
  try { dados = texto ? JSON.parse(texto) : {}; } catch (e) { /* nao-json */ }
  if (!res.ok && !(aceitar && aceitar.includes(res.status))) {
    throw new ErroApi(rotulo, res.status, extrairErro(dados, texto), dados);
  }
  return { dados, res, status: res.status };
}

// Arquivo do disco como Blob: o fetch le do disco aos poucos, sem carregar tudo na memoria.
function arquivoBlob(arquivo, tipo = 'video/mp4') {
  return fs.openAsBlob(arquivo, { type: tipo });
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function nomeArquivo(arquivo) { return path.basename(arquivo); }

module.exports = { pedir, esconder, ErroApi, arquivoBlob, espera, nomeArquivo };
