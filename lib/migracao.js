// Leva o painel do PC pro painel online (Railway) de uma vez:
//  - contas das redes (tokens continuam valendo la) e preferencias
//  - historico de postagens, biblioteca de clipes (com os videos), capas,
//    analises do Estudio (sem o audio bruto) e metricas
//  - usuarios (so o hash da senha), se nenhum estiver com senha provisoria
//
// O painel online so aceita com o codigo de instalacao (SENHA_PAINEL ou o
// gerado nos logs do Railway) e por HTTPS.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ambiente = require('./ambiente');
const cofre = require('./cofre');
const acesso = require('./acesso');

const D = cofre.DADOS;
const JSONS = ['postagens.json', 'clipes.json', 'preferencias.json', 'metricas.json', 'metricas-historico.json'];
// so esses caminhos podem ser gravados no painel online
const CAMINHO_OK = /^(clipes\/[\w-]+\.(mp4|jpg|mov|mkv|webm)|capas\/[\w-]+\.(jpg|json)|estudio\/[\w-]+\/[\w.-]+\.(json|jpg))$/;
const tentativas = [];

const lerJson = (arq, padrao) => { try { return JSON.parse(fs.readFileSync(path.join(D, arq), 'utf8')); } catch (e) { return padrao; } };

// ---------- lado do PC ----------
function listarArquivos(clipesLista) {
  const arquivos = [];
  const add = (abs, rel) => { if (fs.existsSync(abs) && fs.statSync(abs).isFile()) arquivos.push({ abs, rel }); };
  for (const c of clipesLista) {
    if (c.estado !== 'pronto' || !c.arquivo) continue;
    add(c.arquivo, 'clipes/' + c.id + (path.extname(c.arquivo).toLowerCase() || '.mp4'));
    if (c.miniatura) add(c.miniatura, 'clipes/' + c.id + '.jpg');
  }
  for (const pasta of ['capas']) {
    const dir = path.join(D, pasta);
    if (fs.existsSync(dir)) for (const n of fs.readdirSync(dir)) if (/\.(jpg|json)$/.test(n)) add(path.join(dir, n), pasta + '/' + n);
  }
  const est = path.join(D, 'estudio');
  if (fs.existsSync(est)) {
    for (const job of fs.readdirSync(est)) {
      const dir = path.join(est, job);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const n of fs.readdirSync(dir)) if (/\.(json|jpg)$/.test(n)) add(path.join(dir, n), 'estudio/' + job + '/' + n);
    }
  }
  return arquivos.filter((a) => CAMINHO_OK.test(a.rel));
}

async function enviar(destino, codigo, aoProgresso = () => {}) {
  let url;
  try { url = new URL(String(destino || '').trim()); } catch (e) { throw new Error('Endereco do painel online invalido.'); }
  if (url.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) throw new Error('O painel online tem que ser https://');
  const auth = { 'X-Postador': '1', Authorization: 'Bearer ' + String(codigo || '').trim() };
  const pedir = async (caminho, opcoes) => {
    let r;
    try { r = await fetch(url.origin + caminho, { ...opcoes, signal: AbortSignal.timeout(600000) }); } catch (e) {
      throw new Error('Nao consegui falar com o painel online (' + ((e.cause && e.cause.code) || e.message) + '). Ele ja esta no ar?');
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'O painel online respondeu ' + r.status);
    return j;
  };
  // confere o codigo antes de mandar os videos
  await pedir('/api/migrar/conferir', { method: 'POST', headers: auth });

  const clipesLista = lerJson('clipes.json', []);
  const arquivos = listarArquivos(clipesLista);
  const total = arquivos.reduce((n, a) => n + fs.statSync(a.abs).size, 0);
  let enviado = 0;
  for (const a of arquivos) {
    aoProgresso('enviando ' + a.rel, total ? Math.round((enviado / total) * 100) : 0);
    await pedir('/api/migrar/arquivo?caminho=' + encodeURIComponent(a.rel), {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: await fs.openAsBlob(a.abs), duplex: 'half',
    });
    enviado += fs.statSync(a.abs).size;
  }
  aoProgresso('enviando historico e contas', 100);
  const usuarios = acesso.exportarUsuarios();
  const jsons = {};
  for (const n of JSONS) { const v = lerJson(n, null); if (v != null) jsons[n] = v; }
  const r = await pedir('/api/migrar/receber', {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tipo: 'postador-migracao', versao: 2, contas: cofre.todas(), jsons,
      // senha provisoria (admin/admin) nao viaja: la fica o admin do codigo de instalacao
      usuarios: usuarios.some((u) => u.trocarSenha) ? null : usuarios,
    }),
  });
  return { ...r, arquivos: arquivos.length, megas: Math.round(total / 1048576) };
}

// ---------- lado do painel online ----------
function autorizado(req, res, json) {
  if (!ambiente.NUVEM || !ambiente.SENHA) { json(res, 404, { erro: 'Esse painel nao recebe transferencia.' }); return false; }
  const agora = Date.now();
  while (tentativas.length && agora - tentativas[0] > 15 * 60000) tentativas.shift();
  if (tentativas.length >= 10) { json(res, 429, { erro: 'Muitas tentativas. Espere 15 minutos.' }); return false; }
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  const codigo = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!crypto.timingSafeEqual(h(codigo), h(ambiente.SENHA))) {
    tentativas.push(agora);
    json(res, 401, { erro: 'Codigo errado (e o CODIGO DE INSTALACAO dos logs do Railway, ou a SENHA_PAINEL).' });
    return false;
  }
  return true;
}

async function receberArquivo(req, res, json, u) {
  if (!autorizado(req, res, json)) return;
  const rel = String(u.searchParams.get('caminho') || '');
  if (!CAMINHO_OK.test(rel)) return json(res, 400, { erro: 'Caminho nao permitido.' });
  const destino = path.join(D, rel);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const tmp = destino + '.parcial';
  await new Promise((ok, erro) => {
    const s = fs.createWriteStream(tmp);
    req.pipe(s);
    s.on('finish', ok);
    s.on('error', erro);
    req.on('aborted', () => erro(new Error('Envio cancelado.')));
  });
  fs.renameSync(tmp, destino);
  return json(res, 200, { ok: true });
}

async function receber(req, res, json) {
  if (!autorizado(req, res, json)) return;
  let texto = '';
  for await (const d of req) { texto += d; if (texto.length > 20e6) return json(res, 413, { erro: 'Pacote grande demais.' }); }
  let p;
  try { p = JSON.parse(texto); } catch (e) { return json(res, 400, { erro: 'Pacote invalido.' }); }
  if (!p || p.tipo !== 'postador-migracao') return json(res, 400, { erro: 'Pacote invalido.' });
  try {
    const redes = [];
    for (const [plat, campos] of Object.entries(p.contas || {})) {
      if (campos && typeof campos === 'object' && Object.keys(campos).length) { cofre.substituir(plat, campos); redes.push(plat); }
    }
    const j = p.jsons || {};
    // os clipes guardam caminho completo: aponta pros arquivos que acabaram de chegar
    if (Array.isArray(j['clipes.json'])) {
      j['clipes.json'] = j['clipes.json'].map((c) => {
        if (c.estado !== 'pronto' || !c.arquivo) return c;
        const ext = (path.extname(String(c.arquivo).replace(/\\/g, '/')).toLowerCase() || '.mp4');
        const arq = path.join(D, 'clipes', c.id + ext);
        const mini = path.join(D, 'clipes', c.id + '.jpg');
        const novo = { ...c, arquivo: arq, externo: false };
        delete novo.caminhoOriginal;
        if (c.miniatura) novo.miniatura = mini;
        if (!fs.existsSync(arq)) { novo.estado = 'erro'; novo.erro = 'O video nao chegou na transferencia.'; }
        return novo;
      });
    }
    for (const n of JSONS) {
      if (j[n] == null) continue;
      if (n === 'preferencias.json') {
        const atuais = lerJson(n, {});
        cofre.gravarAtomico(path.join(D, n), JSON.stringify({ ...atuais, ...j[n] }, null, 2));
      } else cofre.gravarAtomico(path.join(D, n), JSON.stringify(j[n], null, 1));
    }
    require('./clipes').recarregar();
    require('./postagens').recarregar();
    let usuarios = null;
    if (Array.isArray(p.usuarios) && p.usuarios.length) { acesso.importarUsuarios(p.usuarios); usuarios = p.usuarios.map((x) => x.usuario); }
    return json(res, 200, {
      ok: true, redes, usuarios,
      postagens: Array.isArray(j['postagens.json']) ? j['postagens.json'].length : 0,
      clipes: Array.isArray(j['clipes.json']) ? j['clipes.json'].length : 0,
    });
  } catch (e) { return json(res, 400, { erro: e.message }); }
}

function conferir(req, res, json) { if (autorizado(req, res, json)) json(res, 200, { ok: true }); }

module.exports = { enviar, receber, receberArquivo, conferir };
