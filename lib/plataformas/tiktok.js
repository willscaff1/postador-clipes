// TikTok pela Content Posting API.
// Dois modos:
//  - direto:   publica no perfil (app nao auditado pelo TikTok so consegue "Somente eu")
//  - rascunho: manda pra caixa de entrada do app do TikTok, voce finaliza no celular
const crypto = require('crypto');
const { pedir, arquivoBlob, espera } = require('../http');

const API = 'https://open.tiktokapis.com';
const MB = 1024 * 1024;

// A resposta do TikTok vem 200 com error.code = "ok" quando deu certo.
async function tt(caminho, token, json) {
  const { dados } = await pedir(API + caminho, {
    method: json === undefined ? 'GET' : 'POST', rotulo: 'TikTok', json,
    headers: { Authorization: 'Bearer ' + token },
  });
  if (dados.error && dados.error.code && dados.error.code !== 'ok') {
    throw new Error('TikTok: ' + (dados.error.message || dados.error.code) + ' (' + dados.error.code + ')');
  }
  return dados.data || {};
}

async function tokenValido(cred, ctx) {
  if (!cred.accessToken && !cred.refreshToken) throw new Error('TikTok ainda nao foi conectado. Clique em Conectar na aba Contas.');
  if (cred.accessToken && (!cred.expiraEm || Number(cred.expiraEm) > Date.now() + 60000)) return cred.accessToken;
  if (!cred.refreshToken) throw new Error('O token do TikTok venceu. Clique em Conectar de novo.');
  const { dados } = await pedir(API + '/v2/oauth/token/', {
    method: 'POST', rotulo: 'TikTok',
    form: { client_key: cred.clientKey, client_secret: cred.clientSecret, grant_type: 'refresh_token', refresh_token: cred.refreshToken },
  });
  if (!dados.access_token) throw new Error('TikTok nao renovou o acesso: ' + (dados.error_description || dados.error || 'conecte de novo'));
  const novos = { accessToken: dados.access_token, refreshToken: dados.refresh_token || cred.refreshToken, expiraEm: Date.now() + dados.expires_in * 1000 };
  if (ctx) ctx.salvar(novos);
  Object.assign(cred, novos);
  return novos.accessToken;
}

const NOMES_PRIVACIDADE = {
  PUBLIC_TO_EVERYONE: 'Todo mundo', MUTUAL_FOLLOW_FRIENDS: 'Amigos', FOLLOWER_OF_CREATOR: 'Seguidores', SELF_ONLY: 'Somente eu',
};

module.exports = {
  id: 'tiktok', nome: 'TikTok', tipo: 'destino', oauth: true,
  redirect: (porta) => `http://localhost:${porta}/oauth/tiktok/callback`,
  campos: [
    { nome: 'clientKey', rotulo: 'Client key', obrigatorio: true },
    { nome: 'clientSecret', rotulo: 'Client secret', segredo: true, obrigatorio: true },
    { nome: 'accessToken', rotulo: 'Access token', segredo: true, automatico: true, ajuda: 'Preenchido sozinho quando voce clica em Conectar.' },
    { nome: 'refreshToken', rotulo: 'Refresh token', segredo: true, automatico: true },
  ],
  passos: [
    'Em <a href="https://developers.tiktok.com/apps" target="_blank" rel="noopener">developers.tiktok.com</a>, entre com sua conta e crie um app.',
    'Adicione os produtos <b>Login Kit</b> e <b>Content Posting API</b> (ligue a opcao <b>Direct Post</b>).',
    'Em plataformas marque <b>Desktop</b> e cadastre este endereco de redirecionamento (esta logo abaixo, com botao de copiar).',
    'Escopos: <code>user.info.basic</code>, <code>video.publish</code> e <code>video.upload</code>.',
    'Enquanto o app nao for aprovado, use o <b>Sandbox</b> e adicione sua conta em <b>Target users</b>.',
    'Copie o Client key e o Client secret pra ca, salve e clique em <b>Conectar</b>.',
    'Sem a auditoria do TikTok, post direto sai como <b>Somente eu</b>. O modo <b>Rascunho</b> manda o video pra caixa de entrada do app, e voce publica pelo celular do jeito que quiser.',
  ],
  urlAutorizacao(cred, redirect, estado, extra) {
    if (!cred.clientKey || !cred.clientSecret) throw new Error('Salve o Client key e o Client secret antes de conectar.');
    const verificador = crypto.randomBytes(48).toString('base64url').slice(0, 64);
    extra.verificador = verificador;
    const p = new URLSearchParams({
      client_key: cred.clientKey, scope: 'user.info.basic,video.publish,video.upload', response_type: 'code',
      redirect_uri: redirect, state: estado,
      // O TikTok pede o desafio PKCE em hexadecimal (nao base64url como o padrao).
      code_challenge: crypto.createHash('sha256').update(verificador).digest('hex'), code_challenge_method: 'S256',
    });
    return 'https://www.tiktok.com/v2/auth/authorize/?' + p;
  },
  async concluirAutorizacao(cred, query, redirect, extra) {
    const { dados } = await pedir(API + '/v2/oauth/token/', {
      method: 'POST', rotulo: 'TikTok',
      form: {
        client_key: cred.clientKey, client_secret: cred.clientSecret, code: query.code, grant_type: 'authorization_code',
        redirect_uri: redirect, code_verifier: extra.verificador,
      },
    });
    if (!dados.access_token) throw new Error('TikTok: ' + (dados.error_description || dados.error || 'nao devolveu token'));
    const escopos = String(dados.scope || '');
    if (!/video\.(publish|upload)/.test(escopos)) throw new Error('A autorizacao veio sem permissao de postar video (' + escopos + '). Confira os escopos do app.');
    return { accessToken: dados.access_token, refreshToken: dados.refresh_token, expiraEm: Date.now() + dados.expires_in * 1000, escopos };
  },
  async testar(cred, ctx) {
    const token = await tokenValido(cred, ctx);
    const u = await tt('/v2/user/info/?fields=open_id,display_name', token);
    let extra = '';
    try {
      const c = await tt('/v2/post/publish/creator_info/query/', token, {});
      const opcoes = (c.privacy_level_options || []).map((p) => NOMES_PRIVACIDADE[p] || p).join(', ');
      extra = ' — pode postar como: ' + opcoes + '; ate ' + c.max_video_post_duration_sec + ' s';
    } catch (e) { extra = ' — post direto indisponivel (' + e.message.replace(/^TikTok: /, '') + '), use o modo Rascunho'; }
    return { conta: (u.user && u.user.display_name) + extra };
  },
  avisos(info) {
    const a = [];
    if (info.altura <= info.largura) a.push('TikTok e vertical: use "Preparar > Vertical" antes.');
    if (info.duracao < 3) a.push('TikTok precisa de pelo menos 3 segundos.');
    return a;
  },
  privacidades: NOMES_PRIVACIDADE,
  // Dados que a tela de postar precisa mostrar (regra de UX do TikTok pra Direct Post):
  // conta que vai postar, privacidades liberadas e o que o criador desligou no perfil.
  async criador(cred, ctx) {
    const token = await tokenValido(cred, ctx);
    const c = await tt('/v2/post/publish/creator_info/query/', token, {});
    return {
      apelido: c.creator_nickname, usuario: c.creator_username, foto: c.creator_avatar_url,
      privacidades: (c.privacy_level_options || []).map((id) => ({ id, nome: NOMES_PRIVACIDADE[id] || id })),
      comentarioDesligado: !!c.comment_disabled, duetoDesligado: !!c.duet_disabled, costuraDesligada: !!c.stitch_disabled,
      duracaoMaxima: c.max_video_post_duration_sec || null,
    };
  },
  // Precisa dos escopos user.info.stats e video.list no app do TikTok.
  async metricas(cred, ctx) {
    const token = await tokenValido(cred, ctx);
    const falta = (e) => /scope|permission|access_token_invalid|not authorized/i.test(e.message);
    const aviso = 'Metricas do TikTok precisam dos escopos user.info.stats e video.list: adicione no app do TikTok (developers.tiktok.com) e clique em Reconectar.';
    let conta = {};
    const avisos = [];
    try {
      const u = await tt('/v2/user/info/?fields=follower_count,following_count,likes_count,video_count', token);
      const x = u.user || {};
      conta = { seguidores: x.follower_count, seguindo: x.following_count, curtidas: x.likes_count, videos: x.video_count };
    } catch (e) { if (falta(e)) avisos.push(aviso); else throw e; }
    let posts = [];
    try {
      const v = await tt('/v2/video/list/?fields=id,title,video_description,create_time,share_url,view_count,like_count,comment_count,share_count', token, { max_count: 20 });
      posts = (v.videos || []).map((x) => ({
        id: x.id, titulo: x.title || String(x.video_description || '').split('\n')[0].slice(0, 120), url: x.share_url,
        data: x.create_time ? new Date(x.create_time * 1000).toISOString() : null,
        views: x.view_count, curtidas: x.like_count, comentarios: x.comment_count, compartilhamentos: x.share_count,
      }));
    } catch (e) { if (falta(e)) { if (!avisos.length) avisos.push(aviso); } else throw e; }
    return { conta, posts, avisos };
  },
  async postar(cred, { arquivo, info, opcoes, capa }, log, ctx) {
    const token = await tokenValido(cred, ctx);
    const tamanho = info.tamanho;
    // Pedacos de 5 a 64 MB; o ultimo absorve a sobra.
    const pedaco = tamanho <= 64 * MB ? tamanho : 10 * MB;
    const total = Math.max(1, Math.floor(tamanho / pedaco));
    const origem = { source: 'FILE_UPLOAD', video_size: tamanho, chunk_size: pedaco, total_chunk_count: total };

    let iniciado;
    let virouRascunho = false;
    const rascunho = async () => {
      log('Abrindo envio pra caixa de entrada do TikTok');
      return tt('/v2/post/publish/inbox/video/init/', token, { source_info: origem });
    };
    if (opcoes.modo !== 'direto') {
      iniciado = await rascunho();
    } else {
      const criador = await tt('/v2/post/publish/creator_info/query/', token, {});
      if (criador.max_video_post_duration_sec && info.duracao > criador.max_video_post_duration_sec) {
        throw new Error('Sua conta so aceita ate ' + criador.max_video_post_duration_sec + ' s pela API; o clipe tem ' + Math.round(info.duracao) + ' s.');
      }
      // Regra do TikTok: a privacidade e escolhida pelo usuario a cada post, sem padrao.
      const permitidas = criador.privacy_level_options || [];
      if (!opcoes.privacidade) throw new Error('Escolha "Quem pode ver" antes de postar no TikTok.');
      if (!permitidas.includes(opcoes.privacidade)) throw new Error('O TikTok nao liberou essa privacidade pra sua conta. Opcoes: ' + permitidas.map((p) => NOMES_PRIVACIDADE[p] || p).join(', '));
      if (opcoes.conteudoMarca && opcoes.privacidade === 'SELF_ONLY') throw new Error('Parceria paga nao pode ser "Somente eu".');
      const privacidade = opcoes.privacidade;
      log('Abrindo post direto (' + (NOMES_PRIVACIDADE[privacidade] || privacidade) + ')');
      try {
        iniciado = await tt('/v2/post/publish/video/init/', token, {
          post_info: {
            title: String(opcoes.legenda || '').slice(0, 2200), privacy_level: privacidade,
            // so libera o que o usuario marcou E o criador nao desligou no perfil
            disable_comment: criador.comment_disabled || !opcoes.permitirComentario,
            disable_duet: criador.duet_disabled || !opcoes.permitirDueto,
            disable_stitch: criador.stitch_disabled || !opcoes.permitirCostura,
            brand_organic_toggle: !!opcoes.marcaPropria,
            brand_content_toggle: !!opcoes.conteudoMarca,
            video_cover_timestamp_ms: Math.max(0, Math.round((Number((capa || {}).segundos) || 1) * 1000)),
          },
          source_info: origem,
        });
      } catch (e) {
        // App sem auditoria do TikTok so posta direto em conta PRIVADA. Em conta
        // publica o unico caminho e mandar como rascunho pra caixa de entrada.
        if (!/unaudited_client|private_account/i.test(e.message)) throw e;
        log('TikTok so libera post direto depois da auditoria; mandando como rascunho');
        virouRascunho = true;
        iniciado = await rascunho();
      }
    }

    const blob = await arquivoBlob(arquivo);
    for (let i = 0; i < total; i++) {
      const ini = i * pedaco;
      const fim = i === total - 1 ? tamanho : ini + pedaco;
      log('Enviando o video' + (total > 1 ? ' (parte ' + (i + 1) + '/' + total + ')' : '') + ' — ' + Math.round(tamanho / MB) + ' MB');
      await pedir(iniciado.upload_url, {
        method: 'PUT', rotulo: 'TikTok (upload)', timeout: 1800000, aceitar: [206],
        headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${ini}-${fim - 1}/${tamanho}` },
        body: blob.slice(ini, fim),
      });
    }

    log('TikTok processando o video');
    for (let i = 0; i < 90; i++) {
      await espera(i < 6 ? 5000 : 10000);
      const st = await tt('/v2/post/publish/status/fetch/', token, { publish_id: iniciado.publish_id });
      if (st.status === 'PUBLISH_COMPLETE') {
        const idPost = st.publicaly_available_post_id && st.publicaly_available_post_id[0];
        return { id: String(idPost || iniciado.publish_id), url: idPost ? 'https://www.tiktok.com/video/' + idPost : undefined,
          aviso: idPost ? undefined : 'Publicado, mas visivel so pra voce (app sem auditoria do TikTok ou privacidade "Somente eu").' };
      }
      if (st.status === 'SEND_TO_USER_INBOX') {
        return {
          id: iniciado.publish_id,
          aviso: (virouRascunho ? 'O TikTok so libera post direto depois da auditoria, entao foi como rascunho. ' : '') +
            'Abra o TikTok no celular: o video chega nas notificacoes. Toque, cole a legenda (botao "Copiar legenda" aqui do lado) e publique.',
        };
      }
      if (st.status === 'FAILED') throw new Error('TikTok recusou o video: ' + (st.fail_reason || 'sem motivo informado'));
    }
    throw new Error('TikTok ainda processando depois de 15 min. Confira no app se o video apareceu.');
  },
};
