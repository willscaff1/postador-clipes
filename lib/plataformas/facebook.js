// Pagina do Facebook: Reel (padrao pra clipe vertical) ou video normal.
const { pedir, arquivoBlob, espera, nomeArquivo } = require('../http');

const VERSAO = 'v25.0';
const GRAPH = 'https://graph.facebook.com/' + VERSAO;

// O token que o Graph API Explorer gera vence em ~1h. Com a chave secreta do app
// o sistema troca por um token longo de usuario e, a partir dele, pega o token
// da Pagina, que nao expira. O mesmo token de Pagina publica no Instagram ligado
// a ela, entao a troca ja preenche a conta do Instagram tambem.
async function trocarTokenDoExplorer(cred) {
  const { dados: longo } = await pedir(GRAPH + '/oauth/access_token?' + new URLSearchParams({
    grant_type: 'fb_exchange_token', client_id: cred.appId, client_secret: cred.appSecret, fb_exchange_token: cred.tokenExplorer,
  }), { rotulo: 'Facebook (troca de token)' });
  const { dados: contas } = await pedir(GRAPH + '/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100&access_token=' +
    encodeURIComponent(longo.access_token), { rotulo: 'Facebook' });
  const paginas = contas.data || [];
  const pagina = paginas.find((p) => String(p.id) === String(cred.pageId));
  if (!pagina) {
    throw new Error('A Pagina ' + cred.pageId + ' nao veio na autorizacao. Paginas liberadas: ' +
      (paginas.map((p) => p.name + ' (' + p.id + ')').join(', ') || 'nenhuma') + '. Gere o token de novo marcando a Pagina certa.');
  }
  return pagina;
}

module.exports = {
  id: 'facebook', nome: 'Facebook', tipo: 'destino', oauth: false,
  campos: [
    { nome: 'pageId', rotulo: 'ID da Pagina', obrigatorio: true },
    { nome: 'appId', rotulo: 'ID do app da Meta', ajuda: 'Painel do app, no topo.' },
    { nome: 'appSecret', rotulo: 'Chave secreta do app', segredo: true, ajuda: 'Configuracoes do app > Basico > Chave secreta do app > Mostrar.' },
    { nome: 'tokenExplorer', rotulo: 'Token do Graph API Explorer', segredo: true, ajuda: 'Cole o token do Explorer: o sistema troca pelo token permanente da Pagina e ja configura o Instagram ligado a ela.' },
    { nome: 'pageToken', rotulo: 'Token da Pagina', segredo: true, obrigatorio: true, automatico: true, ajuda: 'Preenchido sozinho a partir do token do Explorer.' },
  ],
  passos: [
    'Precisa ser uma <b>Pagina</b> do Facebook (perfil pessoal nao aceita postagem pela API).',
    'Em <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com/apps</a> use (ou crie) um app com os casos de uso de Pagina e Instagram.',
    'No <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener">Graph API Explorer</a>, escolha o app, adicione <code>pages_show_list</code>, <code>pages_read_engagement</code>, <code>pages_manage_posts</code>, <code>instagram_basic</code>, <code>instagram_content_publish</code>, <code>instagram_manage_contents</code> (pra apagar posts) e <code>business_management</code> e clique em <b>Generate Access Token</b>.',
    'Cole aqui o ID da Pagina, o ID do app, a chave secreta do app e o token do Explorer. Ao salvar, o sistema troca pelo token permanente da Pagina e preenche o Instagram sozinho.',
  ],
  // Chamado quando a conta e salva: faz a troca e devolve o que salvar em cada plataforma.
  async aoSalvar(cred) {
    if (!cred.tokenExplorer) return null;
    if (!cred.appId || !cred.appSecret) throw new Error('Pra trocar o token do Explorer preencha tambem o ID e a chave secreta do app.');
    const pagina = await trocarTokenDoExplorer(cred);
    const saida = { facebook: { pageToken: pagina.access_token, tokenExplorer: null } };
    if (pagina.instagram_business_account) {
      saida.instagram = { token: pagina.access_token, igUserId: String(pagina.instagram_business_account.id) };
    }
    return saida;
  },
  async testar(cred) {
    if (!cred.pageId || !cred.pageToken) throw new Error('Preencha o ID e o token da Pagina.');
    const { dados } = await pedir(GRAPH + '/' + cred.pageId + '?fields=id,name&access_token=' + encodeURIComponent(cred.pageToken), { rotulo: 'Facebook' });
    const { dados: eu } = await pedir(GRAPH + '/me?fields=id&access_token=' + encodeURIComponent(cred.pageToken), { rotulo: 'Facebook' });
    if (String(eu.id) !== String(cred.pageId)) {
      return { conta: dados.name + ' — atencao: o token e de usuario, nao da Pagina. Use o access_token que aparece em me/accounts.' };
    }
    return { conta: dados.name };
  },
  avisos(info, opcoes) {
    const a = [];
    if ((!opcoes || opcoes.modo !== 'video') && (info.duracao < 3 || info.duracao > 90)) a.push('Reel do Facebook precisa ter de 3 a 90 s. Fora disso, use o modo "Video".');
    if ((!opcoes || opcoes.modo !== 'video') && info.altura <= info.largura) a.push('Reel precisa ser vertical (9:16).');
    return a;
  },
  async apagar(cred, { id }) {
    await pedir(GRAPH + '/' + id + '?access_token=' + encodeURIComponent(cred.pageToken), { method: 'DELETE', rotulo: 'Facebook' });
  },
  // Seguidores da Pagina + videos/Reels recentes. Visualizacoes precisam de read_insights.
  async metricas(cred, ctx, { ids = [] } = {}) {
    const tk = '&access_token=' + encodeURIComponent(cred.pageToken);
    const { dados: pg } = await pedir(GRAPH + '/' + cred.pageId + '?fields=name,followers_count,fan_count' + tk, { rotulo: 'Facebook' });
    const campos = 'id,title,description,created_time,permalink_url,likes.summary(true).limit(0),comments.summary(true).limit(0)';
    const { dados: v } = await pedir(GRAPH + '/' + cred.pageId + '/videos?limit=25&fields=' + campos + tk, { rotulo: 'Facebook' }).catch(() => ({ dados: { data: [] } }));
    const lista = v.data || [];
    // posts do app que nao vieram na lista (ex.: Reels) entram pelo ID
    for (const id of ids.filter((x) => !lista.some((y) => y.id === x)).slice(0, 25)) {
      try { lista.push((await pedir(GRAPH + '/' + id + '?fields=' + campos + tk, { rotulo: 'Facebook' })).dados); } catch (e) { /* apagado */ }
    }
    const posts = lista.map((x) => ({
      id: x.id, titulo: x.title || String(x.description || '').split('\n')[0].slice(0, 120),
      url: x.permalink_url ? (x.permalink_url.startsWith('http') ? x.permalink_url : 'https://www.facebook.com' + x.permalink_url) : null,
      data: x.created_time, views: null,
      curtidas: x.likes && x.likes.summary ? x.likes.summary.total_count : null,
      comentarios: x.comments && x.comments.summary ? x.comments.summary.total_count : null,
    })).sort((a, b) => String(b.data).localeCompare(String(a.data)));
    const avisos = [];
    let semPermissao = false;
    await Promise.all(posts.map(async (p) => {
      if (semPermissao) return;
      try {
        const { dados: ins } = await pedir(GRAPH + '/' + p.id + '/video_insights?metric=total_video_views,blue_reels_play_count' + tk, { rotulo: 'Facebook' });
        for (const it of ins.data || []) {
          const val = it.values && it.values[0] && it.values[0].value;
          if (typeof val === 'number') p.views = Math.max(p.views || 0, val);
        }
      } catch (e) {
        if (/permiss|\(#10\)|\(#200\)|403/i.test(e.message)) semPermissao = true;
      }
    }));
    if (semPermissao) avisos.push('Visualizacoes do Facebook precisam da permissao read_insights no token do Explorer.');
    return { conta: { seguidores: pg.followers_count, curtidasPagina: pg.fan_count }, posts, avisos };
  },
  async postar(cred, { arquivo, info, opcoes, capa }, log) {
    const legenda = String(opcoes.legenda || '');
    if (opcoes.modo === 'video') {
      log('Enviando video pra Pagina (' + Math.round(info.tamanho / 1048576) + ' MB)');
      const form = new FormData();
      form.append('access_token', cred.pageToken);
      form.append('description', legenda);
      if (opcoes.titulo) form.append('title', String(opcoes.titulo).slice(0, 255));
      form.append('source', await arquivoBlob(arquivo), nomeArquivo(arquivo));
      const { dados } = await pedir('https://graph-video.facebook.com/' + VERSAO + '/' + cred.pageId + '/videos', {
        method: 'POST', rotulo: 'Facebook', body: form, timeout: 3600000,
      });
      return { id: dados.id, url: 'https://www.facebook.com/' + cred.pageId + '/videos/' + dados.id, aviso: await enviarCapa(dados.id) };
    }

    log('Abrindo o Reel');
    const { dados: ini } = await pedir(GRAPH + '/' + cred.pageId + '/video_reels', {
      method: 'POST', rotulo: 'Facebook', form: { upload_phase: 'start', access_token: cred.pageToken },
    });
    log('Enviando o video (' + Math.round(info.tamanho / 1048576) + ' MB)');
    await pedir('https://rupload.facebook.com/video-upload/' + VERSAO + '/' + ini.video_id, {
      method: 'POST', rotulo: 'Facebook (upload)', timeout: 3600000,
      headers: { Authorization: 'OAuth ' + cred.pageToken, offset: '0', file_size: String(info.tamanho), 'Content-Type': 'application/octet-stream' },
      body: await arquivoBlob(arquivo, 'application/octet-stream'),
    });
    log('Publicando o Reel');
    await pedir(GRAPH + '/' + cred.pageId + '/video_reels', {
      method: 'POST', rotulo: 'Facebook',
      form: { upload_phase: 'finish', video_id: ini.video_id, video_state: 'PUBLISHED', description: legenda, access_token: cred.pageToken },
    });
    for (let i = 0; i < 60; i++) {
      const { dados: st } = await pedir(GRAPH + '/' + ini.video_id + '?fields=status&access_token=' + encodeURIComponent(cred.pageToken), { rotulo: 'Facebook' });
      const s = st.status || {};
      if (s.video_status === 'ready' || (s.publishing_phase && s.publishing_phase.status === 'complete')) break;
      if (s.video_status === 'error' || (s.processing_phase && s.processing_phase.status === 'error')) {
        const erro = (s.processing_phase && s.processing_phase.errors && s.processing_phase.errors[0]) || {};
        throw new Error('Facebook recusou o video: ' + (erro.message || 'erro no processamento'));
      }
      if (i === 59) return { id: ini.video_id, url: 'https://www.facebook.com/reel/' + ini.video_id, aviso: 'Facebook ainda processando; o Reel aparece sozinho quando terminar.' };
      log('Facebook processando o video');
      await espera(10000);
    }
    return { id: ini.video_id, url: 'https://www.facebook.com/reel/' + ini.video_id, aviso: await enviarCapa(ini.video_id) };

    // Capa personalizada (imagem): o Facebook aceita trocar depois de publicado.
    async function enviarCapa(videoId) {
      if (!capa || !capa.arquivo) return undefined;
      log('Enviando a capa');
      try {
        const f = new FormData();
        f.append('access_token', cred.pageToken);
        f.append('is_preferred', 'true');
        f.append('source', await arquivoBlob(capa.arquivo, 'image/jpeg'), 'capa.jpg');
        await pedir(GRAPH + '/' + videoId + '/thumbnails', { method: 'POST', rotulo: 'Facebook (capa)', body: f, timeout: 120000 });
        return undefined;
      } catch (e) {
        return 'O video saiu, mas a capa personalizada nao foi aceita (' + e.message.replace(/^Facebook \(capa\) respondeu /, '') + '). Da pra trocar a capa no app do Facebook.';
      }
    }
  },
};
