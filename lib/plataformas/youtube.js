// YouTube (Shorts ou video normal) pela YouTube Data API v3.
// Login por OAuth: voce cola Client ID/Secret, clica em Conectar, autoriza no
// Google e o app guarda o refresh token sozinho.
const { pedir, arquivoBlob } = require('../http');

const ESCOPOS = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  // apagar video exige esse escopo; conexao antiga precisa de Reconectar
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

async function tokenValido(cred, ctx) {
  if (!cred.refreshToken) throw new Error('YouTube ainda nao foi conectado. Clique em Conectar na aba Contas.');
  if (cred.accessToken && Number(cred.expiraEm) > Date.now() + 60000) return cred.accessToken;
  const { dados } = await pedir('https://oauth2.googleapis.com/token', {
    method: 'POST', rotulo: 'Google',
    form: { client_id: cred.clientId, client_secret: cred.clientSecret, refresh_token: cred.refreshToken, grant_type: 'refresh_token' },
  });
  const novos = { accessToken: dados.access_token, expiraEm: Date.now() + dados.expires_in * 1000 };
  if (ctx) ctx.salvar(novos);
  Object.assign(cred, novos);
  return dados.access_token;
}

function limparTitulo(t) {
  return String(t || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

module.exports = {
  id: 'youtube', nome: 'YouTube', tipo: 'destino', oauth: true,
  redirect: (porta) => `http://127.0.0.1:${porta}/oauth/youtube/callback`,
  campos: [
    { nome: 'clientId', rotulo: 'Client ID (OAuth)', obrigatorio: true },
    { nome: 'clientSecret', rotulo: 'Client Secret', segredo: true, obrigatorio: true },
    { nome: 'refreshToken', rotulo: 'Refresh token', segredo: true, automatico: true, ajuda: 'Preenchido sozinho quando voce clica em Conectar.' },
  ],
  passos: [
    'Abra o <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">Google Cloud Console</a> e crie um projeto (ex.: "Postador de clipes").',
    'Em <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noopener">APIs e servicos &gt; Biblioteca</a>, ative a <b>YouTube Data API v3</b>.',
    'Em <b>Tela de consentimento OAuth</b> (Google Auth Platform): tipo <b>Externo</b>, e em <b>Publico-alvo &gt; Usuarios de teste</b> adicione o e-mail do seu canal.',
    'Em <b>Credenciais &gt; Criar credenciais &gt; ID do cliente OAuth</b>, escolha o tipo <b>App para computador</b>. Copie o Client ID e o Client Secret pra ca.',
    'Salve e clique em <b>Conectar</b>. Escolha o canal e autorize.',
    'Atencao: enquanto o projeto nao passar pela auditoria do Google, todo video enviado pela API fica <b>Privado</b>. Da pra deixar publico na mao no YouTube Studio, ou pedir a auditoria no formulario "YouTube API Services - Audit".',
  ],
  urlAutorizacao(cred, redirect, estado) {
    if (!cred.clientId || !cred.clientSecret) throw new Error('Salve o Client ID e o Client Secret antes de conectar.');
    const p = new URLSearchParams({
      client_id: cred.clientId, redirect_uri: redirect, response_type: 'code', scope: ESCOPOS.join(' '),
      access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true', state: estado,
    });
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
  },
  async concluirAutorizacao(cred, query, redirect) {
    const { dados } = await pedir('https://oauth2.googleapis.com/token', {
      method: 'POST', rotulo: 'Google',
      form: { code: query.code, client_id: cred.clientId, client_secret: cred.clientSecret, redirect_uri: redirect, grant_type: 'authorization_code' },
    });
    if (!dados.refresh_token) throw new Error('O Google nao devolveu refresh token. Remova o acesso do app em myaccount.google.com/permissions e conecte de novo.');
    return { refreshToken: dados.refresh_token, accessToken: dados.access_token, expiraEm: Date.now() + dados.expires_in * 1000 };
  },
  async testar(cred, ctx) {
    const token = await tokenValido(cred, ctx);
    const { dados } = await pedir('https://www.googleapis.com/youtube/v3/channels?part=snippet,status&mine=true', {
      rotulo: 'YouTube', headers: { Authorization: 'Bearer ' + token },
    });
    const canal = dados.items && dados.items[0];
    if (!canal) throw new Error('Essa conta Google nao tem canal no YouTube.');
    return { conta: canal.snippet.title };
  },
  avisos(info) {
    const a = [];
    if (info.altura <= info.largura) a.push('Video horizontal: vai como video normal, nao como Short.');
    else if (info.duracao > 180) a.push('Short vertical passa de 3 min: vai como video normal.');
    return a;
  },
  async apagar(cred, { id }, ctx) {
    const token = await tokenValido(cred, ctx);
    try {
      await pedir('https://www.googleapis.com/youtube/v3/videos?id=' + encodeURIComponent(id), {
        method: 'DELETE', rotulo: 'YouTube', headers: { Authorization: 'Bearer ' + token }, aceitar: [404],
      });
    } catch (e) {
      if (/403|insufficient|scope/i.test(e.message)) throw new Error('Falta permissao pra apagar: clique em Reconectar no cartao do YouTube (aba Contas) e autorize de novo.');
      throw e;
    }
  },
  // Inscritos, views do canal e numeros dos ultimos videos (+ os postados pelo app).
  async metricas(cred, ctx, { ids = [] } = {}) {
    const token = await tokenValido(cred, ctx);
    const h = { Authorization: 'Bearer ' + token };
    const yt = (c) => pedir('https://www.googleapis.com/youtube/v3/' + c, { rotulo: 'YouTube', headers: h }).then((r) => r.dados);
    const ch = await yt('channels?part=statistics,contentDetails&mine=true');
    const c = ch.items && ch.items[0];
    if (!c) throw new Error('Essa conta Google nao tem canal no YouTube.');
    const pl = await yt('playlistItems?part=contentDetails&maxResults=25&playlistId=' + c.contentDetails.relatedPlaylists.uploads).catch(() => ({ items: [] }));
    const vids = [...new Set([...(pl.items || []).map((i) => i.contentDetails.videoId), ...ids])].slice(0, 50);
    const v = vids.length ? await yt('videos?part=snippet,statistics,status,contentDetails&id=' + vids.join(',')) : { items: [] };
    const n = (x) => (x == null ? null : Number(x));
    return {
      conta: { seguidores: c.statistics.hiddenSubscriberCount ? null : n(c.statistics.subscriberCount), views: n(c.statistics.viewCount), videos: n(c.statistics.videoCount) },
      posts: (v.items || []).map((x) => ({
        id: x.id, titulo: x.snippet.title, url: 'https://youtu.be/' + x.id, data: x.snippet.publishedAt,
        views: n(x.statistics.viewCount), curtidas: n(x.statistics.likeCount), comentarios: n(x.statistics.commentCount),
        privado: x.status.privacyStatus !== 'public',
      })).sort((a, b) => String(b.data).localeCompare(String(a.data))),
    };
  },
  async postar(cred, { arquivo, info, opcoes, capa }, log, ctx) {
    const token = await tokenValido(cred, ctx);
    let descricao = String(opcoes.descricao || '');
    const ehShort = info.altura > info.largura && info.duracao <= 180;
    if (opcoes.shorts !== false && ehShort && !/#shorts/i.test(descricao + ' ' + (opcoes.titulo || ''))) {
      descricao = (descricao + '\n\n#Shorts').trim();
    }
    const titulo = limparTitulo(opcoes.titulo) || 'Clipe';
    // tags: sem <>, cada uma ate 30 chars, total ate 500
    const tags = [];
    let total = 0;
    for (const t of (opcoes.tags || []).map((x) => String(x).replace(/[<>#]/g, '').trim()).filter(Boolean)) {
      if (t.length > 30 || total + t.length + 1 > 500) continue;
      tags.push(t); total += t.length + 1;
    }
    const status = {
      privacyStatus: opcoes.publicarEm ? 'private' : (opcoes.privacidade || 'public'),
      selfDeclaredMadeForKids: !!opcoes.paraCriancas,
    };
    if (opcoes.publicarEm) status.publishAt = opcoes.publicarEm; // agendado: privado ate a hora marcada
    const meta = {
      snippet: {
        title: titulo, description: descricao.slice(0, 5000), categoryId: String(opcoes.categoria || '20'),
        tags, defaultLanguage: 'pt-BR', defaultAudioLanguage: 'pt-BR',
      },
      status,
    };
    const partes = ['snippet', 'status'];
    if (opcoes.restricaoIdade && !opcoes.paraCriancas) {
      meta.contentDetails = { contentRating: { ytRating: 'ytAgeRestricted' } };
      partes.push('contentDetails');
    }
    const notificar = opcoes.notificar === false || opcoes.paraCriancas ? 'false' : 'true';
    log('Abrindo envio no YouTube');
    const abrir = (m, p) => pedir('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&notifySubscribers=' + notificar + '&part=' + p.join(','), {
      method: 'POST', rotulo: 'YouTube', json: m,
      headers: { Authorization: 'Bearer ' + token, 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(info.tamanho) },
    });
    let res;
    let semRestricao = false;
    try {
      ({ res } = await abrir(meta, partes));
    } catch (e) {
      // se a API nao aceitar a classificacao de idade no envio, sobe sem e avisa pra marcar no Studio
      if (!meta.contentDetails) throw e;
      delete meta.contentDetails;
      semRestricao = true;
      log('A API nao aceitou a restricao de idade no envio; subindo sem ela');
      ({ res } = await abrir(meta, ['snippet', 'status']));
    }
    const destino = res.headers.get('location');
    if (!destino) throw new Error('YouTube nao devolveu o endereco de envio.');
    log('Enviando o video (' + Math.round(info.tamanho / 1048576) + ' MB)');
    const { dados } = await pedir(destino, {
      method: 'PUT', rotulo: 'YouTube', timeout: 3600000,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'video/mp4' },
      body: await arquivoBlob(arquivo),
    });
    const privado = dados.status && dados.status.privacyStatus;
    const avisos = [];
    if (capa && capa.arquivo) {
      log('Enviando a capa');
      try {
        await pedir('https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=' + dados.id, {
          method: 'POST', rotulo: 'YouTube (capa)', timeout: 120000,
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/jpeg' },
          body: await arquivoBlob(capa.arquivo, 'image/jpeg'),
        });
        if (ehShort) avisos.push('Capa enviada; em Short o YouTube pode continuar mostrando um quadro do video no feed de Shorts.');
      } catch (e) {
        avisos.push(/403|forbidden|permission/i.test(e.message)
          ? 'A capa personalizada nao foi aceita: o canal precisa estar verificado por telefone (youtube.com/verify).'
          : 'A capa nao foi enviada: ' + e.message);
      }
    }
    if (privado === 'private' && opcoes.privacidade !== 'private' && !opcoes.publicarEm) {
      avisos.push('O YouTube deixou o video como Privado (projeto da API ainda nao auditado). Mude pra Publico no YouTube Studio.');
    }
    if (opcoes.publicarEm) avisos.push('Agendado para ' + new Date(opcoes.publicarEm).toLocaleString('pt-BR') + '.');
    if (semRestricao) avisos.push('Marque a restricao de idade 18+ no YouTube Studio: a API nao aceitou no envio.');
    return {
      id: dados.id,
      url: (ehShort ? 'https://youtube.com/shorts/' : 'https://youtu.be/') + dados.id,
      aviso: avisos.join(' ') || undefined,
    };
  },
};
