// X (Twitter): sobe o video pela API v2 de midia e publica o post.
// Autenticacao OAuth 1.0a com as 4 chaves do app (API key/secret + access token/secret).
const crypto = require('crypto');
const { pedir, arquivoBlob, espera } = require('../http');

const API = 'https://api.x.com';
const PEDACO = 4 * 1024 * 1024;

function pct(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

// Corpo JSON e multipart nao entram na assinatura; so os parametros da URL.
// `token`/`segredoToken` trocam o par do usuario (no login ainda nao existe) e
// `extras` sao parametros oauth_* a mais (oauth_callback, oauth_verifier).
function assinatura(metodo, url, cred, { token = cred.accessToken, segredoToken = cred.accessSecret, extras = {} } = {}) {
  const u = new URL(url);
  const oauth = {
    oauth_consumer_key: cred.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    ...extras,
  };
  if (token) oauth.oauth_token = token;
  const pares = [...u.searchParams.entries(), ...Object.entries(oauth)]
    .map(([k, v]) => [pct(k), pct(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const base = [metodo.toUpperCase(), pct(u.origin + u.pathname), pct(pares.map(([k, v]) => k + '=' + v).join('&'))].join('&');
  const chave = pct(cred.apiSecret) + '&' + pct(segredoToken || '');
  oauth.oauth_signature = crypto.createHmac('sha1', chave).update(base).digest('base64');
  return 'OAuth ' + Object.entries(oauth).map(([k, v]) => pct(k) + '="' + pct(v) + '"').join(', ');
}

function x(metodo, caminho, cred, extra = {}) {
  const url = API + caminho;
  return pedir(url, { method: metodo, rotulo: 'X', ...extra, headers: { ...(extra.headers || {}), Authorization: assinatura(metodo, url, cred) } });
}

function conferir(cred) {
  if (!cred.apiKey || !cred.apiSecret) throw new Error('Preencha a API Key e a API Key Secret do X.');
  if (!cred.accessToken || !cred.accessSecret) throw new Error('Falta conectar a conta: clique em Conectar no cartao do X.');
}

// Resposta do OAuth 1.0a vem como form: oauth_token=...&oauth_token_secret=...
async function oauthForm(caminho, cred, opcoes) {
  const url = API + caminho;
  const { dados } = await pedir(url, { method: 'POST', rotulo: 'X (login)', headers: { Authorization: assinatura('POST', url, cred, opcoes) } });
  return Object.fromEntries(new URLSearchParams(typeof dados === 'string' ? dados : ''));
}

module.exports = {
  id: 'x', nome: 'X (Twitter)', tipo: 'destino', oauth: true,
  redirect: (porta) => `http://localhost:${porta}/oauth/x/callback`,
  campos: [
    { nome: 'apiKey', rotulo: 'API Key (Consumer Key)', obrigatorio: true },
    { nome: 'apiSecret', rotulo: 'API Key Secret', segredo: true, obrigatorio: true },
    { nome: 'accessToken', rotulo: 'Access Token', segredo: true, automatico: true, ajuda: 'Preenchido sozinho quando voce clica em Conectar.' },
    { nome: 'accessSecret', rotulo: 'Access Token Secret', segredo: true, automatico: true },
  ],
  passos: [
    'Entre em <a href="https://console.x.com" target="_blank" rel="noopener">console.x.com</a> com a conta que vai postar e abra seu app.',
    'Em <b>User authentication settings</b>: permissao <b>Read and write</b>, tipo <b>Web App, Automated App or Bot</b> e cadastre este endereco de redirecionamento (logo abaixo, com botao de copiar).',
    'Em <b>OAuth 1.0 Keys &gt; Consumer Key</b>, clique em Regenerate e cole a <b>API Key</b> e a <b>API Key Secret</b> aqui. Salve.',
    'Clique em <b>Conectar</b> e autorize no X. O Access Token e preenchido sozinho.',
    'O X cobra por uso da API: sem credito em <b>Billing &gt; Credits</b> o post de video nao sai.',
  ],
  async urlAutorizacao(cred, redirect, estado, extra) {
    if (!cred.apiKey || !cred.apiSecret) throw new Error('Salve a API Key e a API Key Secret antes de conectar.');
    // O X nao devolve "state": o servidor acha o pedido pelo oauth_token (extra.tokenTemp).
    const r = await oauthForm('/oauth/request_token', cred, {
      token: null, segredoToken: '', extras: { oauth_callback: redirect },
    });
    if (r.oauth_callback_confirmed !== 'true' || !r.oauth_token) throw new Error('O X recusou o pedido de login. Confira se o redirecionamento ' + redirect + ' esta cadastrado no app.');
    extra.tokenTemp = r.oauth_token;
    extra.segredoTemp = r.oauth_token_secret;
    return API + '/oauth/authorize?oauth_token=' + encodeURIComponent(r.oauth_token);
  },
  async concluirAutorizacao(cred, query, redirect, extra) {
    if (query.denied) throw new Error('Autorizacao recusada no X.');
    if (query.oauth_token !== extra.tokenTemp) throw new Error('Resposta do X nao bate com o pedido. Clique em Conectar de novo.');
    const r = await oauthForm('/oauth/access_token', cred, {
      token: extra.tokenTemp, segredoToken: extra.segredoTemp, extras: { oauth_verifier: query.oauth_verifier },
    });
    if (!r.oauth_token || !r.oauth_token_secret) throw new Error('O X nao devolveu o token de acesso.');
    return { accessToken: r.oauth_token, accessSecret: r.oauth_token_secret, usuario: r.screen_name };
  },
  async testar(cred) {
    conferir(cred);
    const { dados } = await x('GET', '/2/users/me', cred);
    return { conta: '@' + dados.data.username };
  },
  avisos(info) {
    const a = [];
    if (info.duracao > 140) a.push('X aceita ate 2 min 20 s de video (contas sem Premium).');
    if (info.tamanho > 512 * 1048576) a.push('X aceita ate 512 MB.');
    return a;
  },
  async apagar(cred, { id }) {
    conferir(cred);
    await x('DELETE', '/2/tweets/' + encodeURIComponent(id), cred, { aceitar: [404] });
  },
  // Leitura na API do X tambem gasta credito; sem credito devolve so o aviso.
  async metricas(cred, ctx, { ids = [] } = {}) {
    conferir(cred);
    try {
      const { dados: eu } = await x('GET', '/2/users/me?user.fields=public_metrics', cred);
      const pm = (eu.data && eu.data.public_metrics) || {};
      let posts = [];
      if (ids.length) {
        const { dados: t } = await x('GET', '/2/tweets?tweet.fields=public_metrics,created_at&ids=' + ids.slice(0, 100).join(','), cred);
        posts = (t.data || []).map((p) => ({
          id: p.id, titulo: String(p.text || '').split('\n')[0].slice(0, 120), url: 'https://x.com/i/status/' + p.id, data: p.created_at,
          views: p.public_metrics.impression_count, curtidas: p.public_metrics.like_count,
          comentarios: p.public_metrics.reply_count, compartilhamentos: p.public_metrics.retweet_count,
        }));
      }
      return { conta: { seguidores: pm.followers_count, seguindo: pm.following_count, videos: pm.tweet_count }, posts };
    } catch (e) {
      if (/402|credit/i.test(e.message)) return { conta: {}, posts: [], avisos: ['O X cobra credito ate pra ler metricas; sem credito na conta de desenvolvedor nao vem nada.'] };
      throw e;
    }
  },
  async postar(cred, { arquivo, info, opcoes }, log) {
    conferir(cred);
    log('Abrindo envio de midia no X');
    const { dados: ini } = await x('POST', '/2/media/upload/initialize', cred, {
      json: { media_type: 'video/mp4', total_bytes: info.tamanho, media_category: 'tweet_video' },
    });
    const idMidia = ini.data.id;
    const blob = await arquivoBlob(arquivo);
    const partes = Math.ceil(info.tamanho / PEDACO);
    for (let i = 0; i < partes; i++) {
      log('Enviando o video (parte ' + (i + 1) + '/' + partes + ')');
      const form = new FormData();
      form.append('segment_index', String(i));
      form.append('media', blob.slice(i * PEDACO, Math.min(info.tamanho, (i + 1) * PEDACO)), 'parte' + i + '.mp4');
      await x('POST', '/2/media/upload/' + idMidia + '/append', cred, { body: form, timeout: 600000 });
    }
    const { dados: fin } = await x('POST', '/2/media/upload/' + idMidia + '/finalize', cred);
    let proc = fin.data && fin.data.processing_info;
    while (proc && proc.state !== 'succeeded') {
      if (proc.state === 'failed') throw new Error('X recusou o video: ' + ((proc.error && proc.error.message) || 'erro no processamento'));
      log('X processando o video');
      await espera(Math.max(2, proc.check_after_secs || 5) * 1000);
      const { dados: st } = await x('GET', '/2/media/upload?command=STATUS&media_id=' + idMidia, cred);
      proc = st.data && st.data.processing_info;
    }
    log('Publicando o post');
    const { dados: post } = await x('POST', '/2/tweets', cred, {
      json: { text: String(opcoes.texto || ''), media: { media_ids: [idMidia] } },
    });
    return { id: post.data.id, url: 'https://x.com/i/status/' + post.data.id };
  },
};
