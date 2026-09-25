// Twitch como FONTE de clipes.
//
// Conectar (OAuth) liga a sua conta: o app descobre seu canal sozinho e passa a
// usar a API oficial (Helix) como reserva. Sem conectar ele ainda funciona: lista
// e baixa pelo mesmo caminho que o site da Twitch usa no navegador, que e o unico
// que informa se o clipe tem a versao vertical montada.
const { pedir } = require('../http');

const GQL_CLIENT = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // cliente publico do site twitch.tv
let tokenApp = null;

async function gql(query, variables) {
  const { dados } = await pedir('https://gql.twitch.tv/gql', {
    method: 'POST', rotulo: 'Twitch',
    headers: { 'Client-ID': GQL_CLIENT, 'Content-Type': 'text/plain' },
    body: JSON.stringify({ query, variables }),
  });
  if (dados.errors && dados.errors.length) throw new Error('Twitch: ' + dados.errors[0].message);
  return dados.data;
}

async function obterTokenApp(cred) {
  if (tokenApp && tokenApp.clientId === cred.clientId && tokenApp.expira > Date.now() + 60000) return tokenApp.valor;
  const { dados } = await pedir('https://id.twitch.tv/oauth2/token', {
    method: 'POST', rotulo: 'Twitch',
    form: { client_id: cred.clientId, client_secret: cred.clientSecret, grant_type: 'client_credentials' },
  });
  tokenApp = { clientId: cred.clientId, valor: dados.access_token, expira: Date.now() + dados.expires_in * 1000 };
  return tokenApp.valor;
}

// Token do usuario (Conectar) renova sozinho; sem ele, usa o token de app.
async function tokenUsuario(cred, ctx) {
  if (!cred.refreshToken) return null;
  if (cred.accessToken && Number(cred.expiraEm) > Date.now() + 60000) return cred.accessToken;
  const { dados } = await pedir('https://id.twitch.tv/oauth2/token', {
    method: 'POST', rotulo: 'Twitch',
    form: { client_id: cred.clientId, client_secret: cred.clientSecret, grant_type: 'refresh_token', refresh_token: cred.refreshToken },
  });
  const novos = { accessToken: dados.access_token, refreshToken: dados.refresh_token || cred.refreshToken, expiraEm: Date.now() + dados.expires_in * 1000 };
  if (ctx) ctx.salvar(novos);
  Object.assign(cred, novos);
  return novos.accessToken;
}

async function helix(cred, caminho, ctx) {
  const token = (await tokenUsuario(cred, ctx)) || await obterTokenApp(cred);
  const { dados } = await pedir('https://api.twitch.tv/helix' + caminho, {
    rotulo: 'Twitch', headers: { 'Client-ID': cred.clientId, Authorization: 'Bearer ' + token },
  });
  return dados;
}

function temCredencial(cred) { return !!(cred.clientId && cred.clientSecret); }

function limparCanal(canal) {
  return String(canal || '').trim().replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').replace(/[/?#].*$/, '').replace(/^@/, '').toLowerCase();
}

// Aceita clips.twitch.tv/SLUG, twitch.tv/canal/clip/SLUG e m.twitch.tv/...
function slugDoLink(url) {
  const m = /clips\.twitch\.tv\/(?:embed\?clip=)?([\w-]+)/i.exec(url) || /twitch\.tv\/[^/]+\/clip\/([\w-]+)/i.exec(url);
  return m ? m[1] : null;
}

async function listarClipes(cred, canal, dias = 7) {
  const login = limparCanal(canal);
  if (!login) throw new Error('Informe o canal da Twitch.');
  const desde = new Date(Date.now() - dias * 86400000);

  try {
    return await listarPorGql(login, dias);
  } catch (e) {
    if (!temCredencial(cred)) throw e;
  }
  {
    const u = await helix(cred, '/users?login=' + encodeURIComponent(login));
    const usuario = u.data && u.data[0];
    if (!usuario) throw new Error('Canal "' + login + '" nao encontrado na Twitch.');
    const c = await helix(cred, '/clips?first=50&broadcaster_id=' + usuario.id +
      '&started_at=' + desde.toISOString() + '&ended_at=' + new Date().toISOString());
    return (c.data || []).sort((a, b) => b.view_count - a.view_count).map((x) => ({
      slug: x.id, url: x.url, titulo: x.title, views: x.view_count, criadoEm: x.created_at,
      duracao: x.duration, miniatura: x.thumbnail_url, autor: x.creator_name, canal: usuario.display_name,
    }));
  }
}

async function listarPorGql(login, dias) {
  const periodo = dias <= 1 ? 'LAST_DAY' : dias <= 7 ? 'LAST_WEEK' : dias <= 31 ? 'LAST_MONTH' : 'ALL_TIME';
  const d = await gql(`query($login:String!,$periodo:ClipsPeriod){user(login:$login){displayName clips(first:50,criteria:{period:$periodo,sort:VIEWS_DESC}){edges{node{slug url title viewCount createdAt durationSeconds thumbnailURL curator{displayName} assets{type}}}}}}`,
    { login, periodo });
  if (!d.user) throw new Error('Canal "' + login + '" nao encontrado na Twitch.');
  return d.user.clips.edges.map(({ node: x }) => ({
    slug: x.slug, url: x.url, titulo: x.title, views: x.viewCount, criadoEm: x.createdAt,
    duracao: x.durationSeconds, miniatura: x.thumbnailURL, autor: x.curator && x.curator.displayName, canal: d.user.displayName,
    temVertical: (x.assets || []).some((a) => a.type === 'RECOMPOSED'),
  }));
}

const maiorQualidade = (lista) => [...(lista || [])].sort((a, b) => Number(b.quality) - Number(a.quality) || b.frameRate - a.frameRate)[0];

// Devolve o endereco do MP4 na melhor qualidade. Com `vertical`, usa a versao
// 9:16 que o streamer montou no editor de clipes da Twitch (camera + jogo ja
// posicionados, asset "RECOMPOSED"), quando ela existir.
async function linkDoClipe(slug, { vertical = false } = {}) {
  const d = await gql('query($slug:ID!){clip(slug:$slug){title durationSeconds broadcaster{displayName} ' +
    'playbackAccessToken(params:{platform:"web",playerBackend:"mediaplayer",playerType:"site"}){signature value} ' +
    'videoQualities{quality frameRate sourceURL} assets{type aspectRatio videoQualities{quality frameRate sourceURL}}}}', { slug });
  const c = d.clip;
  if (!c) throw new Error('Clipe da Twitch nao encontrado (pode ter sido apagado).');
  const retrato = (c.assets || []).find((a) => a.type === 'RECOMPOSED' || (a.aspectRatio && a.aspectRatio < 1));
  const usarVertical = vertical && retrato && retrato.videoQualities && retrato.videoQualities.length;
  const melhor = maiorQualidade(usarVertical ? retrato.videoQualities : c.videoQualities);
  if (!melhor) throw new Error('A Twitch nao liberou o video desse clipe.');
  return {
    titulo: c.title,
    canal: c.broadcaster && c.broadcaster.displayName,
    url: melhor.sourceURL + '?sig=' + c.playbackAccessToken.signature + '&token=' + encodeURIComponent(c.playbackAccessToken.value),
    qualidade: (usarVertical ? 'vertical da Twitch, ' : '') + melhor.quality + 'p',
    vertical: !!usarVertical,
    temVertical: !!retrato,
  };
}


// ---------- lives (VODs), ao vivo e metricas ----------

const segundosDe = (d) => { const m = /(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/.exec(String(d || '')); return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0); };

async function meuId(cred, ctx) {
  if (cred.usuarioId) return cred.usuarioId;
  const login = limparCanal(cred.canalPadrao);
  if (!login) throw new Error('Conecte a Twitch na aba Contas.');
  const u = await helix(cred, '/users?login=' + encodeURIComponent(login), ctx);
  const id = u.data && u.data[0] && u.data[0].id;
  if (!id) throw new Error('Canal da Twitch nao encontrado.');
  if (ctx) ctx.salvar({ usuarioId: id });
  return id;
}

// Lives gravadas do canal (as que a Twitch guarda como VOD).
async function listarLives(cred, ctx) {
  if (!temCredencial(cred)) throw new Error('Conecte a Twitch na aba Contas.');
  const id = await meuId(cred, ctx);
  const v = await helix(cred, '/videos?type=archive&first=50&user_id=' + id, ctx);
  return (v.data || []).map((x) => ({
    id: x.id, titulo: x.title, url: x.url, criadoEm: x.created_at, duracao: segundosDe(x.duration), views: x.view_count,
    miniatura: x.thumbnail_url ? x.thumbnail_url.replace('%{width}', '480').replace('%{height}', '270') : null,
    canal: x.user_name,
  }));
}

async function aoVivo(cred, ctx) {
  const id = await meuId(cred, ctx);
  const s = await helix(cred, '/streams?user_id=' + id, ctx);
  const x = s.data && s.data[0];
  return x ? { titulo: x.title, jogo: x.game_name, espectadores: x.viewer_count, desde: x.started_at } : null;
}

// Endereco HLS da live gravada (master playlist) pra ver e cortar.
async function hlsDaLive(idVod) {
  const d = await gql('query($id:ID!){videoPlaybackAccessToken(id:$id,params:{platform:"web",playerBackend:"mediaplayer",playerType:"site"}){value signature}}', { id: String(idVod) });
  const t = d.videoPlaybackAccessToken;
  if (!t) throw new Error('A Twitch nao liberou essa live (pode ter expirado ou ser so pra inscritos).');
  return 'https://usher.ttvnw.net/vod/' + encodeURIComponent(idVod) + '.m3u8?' + new URLSearchParams({
    sig: t.signature, token: t.value, allow_source: 'true', allow_audio_only: 'true', player: 'twitchweb', p: String(Math.floor(Math.random() * 1e6)),
  });
}

// Clipe da live que esta rolando agora (precisa estar ao vivo).
async function clipar(cred, ctx) {
  const token = await tokenUsuario(cred, ctx);
  if (!token) throw new Error('Conecte a Twitch (botao Conectar) pra criar clipe.');
  const id = await meuId(cred, ctx);
  const { dados } = await pedir('https://api.twitch.tv/helix/clips?broadcaster_id=' + id, {
    method: 'POST', rotulo: 'Twitch', headers: { 'Client-ID': cred.clientId, Authorization: 'Bearer ' + token },
  });
  const c = dados.data && dados.data[0];
  if (!c) throw new Error('A Twitch nao criou o clipe (o canal esta ao vivo?).');
  return { id: c.id, url: 'https://clips.twitch.tv/' + c.id };
}

async function metricas(cred, ctx) {
  const id = await meuId(cred, ctx);
  const [seg, vivo, lives, clipes] = await Promise.all([
    helix(cred, '/channels/followers?first=1&broadcaster_id=' + id, ctx),
    aoVivo(cred, ctx).catch(() => null),
    listarLives(cred, ctx).catch(() => []),
    helix(cred, '/clips?first=50&broadcaster_id=' + id + '&started_at=' + new Date(Date.now() - 30 * 86400000).toISOString(), ctx).catch(() => ({ data: [] })),
  ]);
  return {
    conta: { seguidores: seg.total, lives: lives.length, viewsLives: lives.reduce((n, l) => n + (l.views || 0), 0) },
    aoVivo: vivo,
    lives: lives.slice(0, 20).map((l) => ({ id: l.id, titulo: l.titulo, url: l.url, data: l.criadoEm, views: l.views, duracao: l.duracao })),
    posts: (clipes.data || []).sort((a, b) => b.view_count - a.view_count).slice(0, 20).map((c) => ({
      id: c.id, titulo: c.title, url: c.url, data: c.created_at, views: c.view_count, tipo: 'clipe',
    })),
  };
}

// Novos seguidores por dia (a Twitch informa a data de cada follow; quem saiu nao).
// Precisa do escopo moderator:read:followers (Reconectar).
async function seguidoresPorDia(cred, ctx, dias = 30) {
  const token = await tokenUsuario(cred, ctx);
  if (!token) return { dias: [], aviso: 'Conecte a Twitch (Conectar) pra ver os novos seguidores.' };
  const id = await meuId(cred, ctx);
  const limite = Date.now() - dias * 86400000;
  const porDia = {};
  let cursor = '';
  try {
    for (let pagina = 0; pagina < 20; pagina++) {
      const { dados } = await pedir('https://api.twitch.tv/helix/channels/followers?first=100&broadcaster_id=' + id + (cursor ? '&after=' + cursor : ''), {
        rotulo: 'Twitch', headers: { 'Client-ID': cred.clientId, Authorization: 'Bearer ' + token },
      });
      let passou = false;
      for (const f of dados.data || []) {
        const t = new Date(f.followed_at).getTime();
        if (t < limite) { passou = true; break; }
        const dia = f.followed_at.slice(0, 10);
        porDia[dia] = (porDia[dia] || 0) + 1;
      }
      cursor = dados.pagination && dados.pagination.cursor;
      if (passou || !cursor) break;
    }
  } catch (e) {
    if (/401|403|scope|Missing/i.test(e.message)) return { dias: [], aviso: 'Pra ver os novos seguidores da Twitch, clique em Reconectar no cartao da Twitch (permissao nova).' };
    throw e;
  }
  return { dias: Object.entries(porDia).map(([dia, ganhos]) => ({ dia, ganhos, perdas: null })).sort((a, b) => a.dia.localeCompare(b.dia)) };
}

// clips:edit deixa criar clipe da live pelo app; user:read:email so pra identificar a conta.
const ESCOPOS = ['clips:edit', 'user:read:email', 'moderator:read:followers'];

module.exports = {
  id: 'twitch', nome: 'Twitch', tipo: 'fonte', oauth: true,
  opcional: true,
  redirect: () => require('../ambiente').urlRetorno('twitch'),
  campos: [
    { nome: 'clientId', rotulo: 'Client ID', obrigatorio: true },
    { nome: 'clientSecret', rotulo: 'Client Secret', segredo: true, obrigatorio: true },
    { nome: 'refreshToken', rotulo: 'Conexao da conta', segredo: true, automatico: true, ajuda: 'Preenchido sozinho quando voce clica em Conectar.' },
    { nome: 'canalPadrao', rotulo: 'Seu canal', ajuda: 'Preenchido sozinho ao conectar; ja vem na busca de clipes.' },
  ],
  passos: [
    'Opcional: sem isso a busca e o download de clipes ja funcionam. Conectado, o app ja sabe qual e o seu canal e usa a API oficial da Twitch.',
    'Abra <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noopener">dev.twitch.tv/console/apps</a> e clique em <b>Registrar seu aplicativo</b> (a Twitch exige autenticacao em dois fatores ligada na conta).',
    'Nome: qualquer um (ex.: Postador WillScaff). URL de redirecionamento: o endereco mostrado aqui embaixo. Categoria: <b>Other</b>. Tipo de cliente: <b>Confidencial</b>.',
    'Abra o app criado, copie o <b>Client ID</b> e clique em <b>Novo segredo</b> pra gerar o Client Secret. Cole os dois aqui, salve e clique em <b>Conectar</b>.',
  ],
  urlAutorizacao(cred, redirect, estado) {
    if (!cred.clientId || !cred.clientSecret) throw new Error('Salve o Client ID e o Client Secret antes de conectar.');
    return 'https://id.twitch.tv/oauth2/authorize?' + new URLSearchParams({
      client_id: cred.clientId, redirect_uri: redirect, response_type: 'code', scope: ESCOPOS.join(' '), state: estado, force_verify: 'true',
    });
  },
  async concluirAutorizacao(cred, query, redirect) {
    if (query.error) throw new Error('A Twitch recusou: ' + (query.error_description || query.error));
    const { dados } = await pedir('https://id.twitch.tv/oauth2/token', {
      method: 'POST', rotulo: 'Twitch',
      form: { client_id: cred.clientId, client_secret: cred.clientSecret, code: query.code, grant_type: 'authorization_code', redirect_uri: redirect },
    });
    const { dados: u } = await pedir('https://api.twitch.tv/helix/users', {
      rotulo: 'Twitch', headers: { 'Client-ID': cred.clientId, Authorization: 'Bearer ' + dados.access_token },
    });
    const eu = (u.data && u.data[0]) || {};
    return {
      accessToken: dados.access_token, refreshToken: dados.refresh_token, expiraEm: Date.now() + dados.expires_in * 1000,
      usuarioId: eu.id, canalPadrao: eu.login || cred.canalPadrao,
    };
  },
  async testar(cred, ctx) {
    if (!temCredencial(cred)) throw new Error('Preencha Client ID e Client Secret.');
    tokenApp = null; // testa a chave de verdade, nao a que ficou em memoria
    if (cred.refreshToken) {
      const { dados } = await pedir('https://api.twitch.tv/helix/users', {
        rotulo: 'Twitch', headers: { 'Client-ID': cred.clientId, Authorization: 'Bearer ' + await tokenUsuario(cred, ctx) },
      });
      const eu = dados.data && dados.data[0];
      if (!eu) throw new Error('A Twitch nao devolveu a conta conectada. Clique em Reconectar.');
      return { conta: eu.display_name };
    }
    await obterTokenApp(cred);
    if (cred.canalPadrao) {
      const u = await helix(cred, '/users?login=' + encodeURIComponent(limparCanal(cred.canalPadrao)));
      if (!u.data || !u.data[0]) return { conta: 'chave ok, mas o canal "' + cred.canalPadrao + '" nao existe' };
      return { conta: u.data[0].display_name + ' (chave ok; clique em Conectar pra ligar a conta)' };
    }
    return { conta: 'chave ok; clique em Conectar pra ligar a conta' };
  },
  listarClipes, linkDoClipe, slugDoLink, limparCanal, listarLives, aoVivo, hlsDaLive, clipar, metricas, seguidoresPorDia,
};
