// Instagram Reels pela API oficial de publicacao.
// Aceita os dois tipos de token:
//  - "IG..."  (API com login do Instagram)  -> graph.instagram.com
//  - "EAA..." (API com login do Facebook)   -> graph.facebook.com + ID da conta IG
// O video sobe direto do disco (upload resumable), sem precisar hospedar em lugar nenhum.
const { pedir, arquivoBlob, espera } = require('../http');

const VERSAO = 'v25.0';

function host(cred) {
  return String(cred.token || '').startsWith('IG') ? 'https://graph.instagram.com' : 'https://graph.facebook.com';
}

async function contaId(cred, ctx) {
  if (cred.igUserId) return cred.igUserId;
  if (host(cred).includes('instagram')) {
    const { dados } = await pedir(host(cred) + '/' + VERSAO + '/me?fields=user_id,username&access_token=' + encodeURIComponent(cred.token), { rotulo: 'Instagram' });
    const id = dados.user_id || dados.id;
    if (ctx && id) ctx.salvar({ igUserId: String(id) });
    return String(id);
  }
  throw new Error('Com token do Facebook (EAA...) preencha tambem o ID da conta do Instagram.');
}

module.exports = {
  id: 'instagram', nome: 'Instagram', tipo: 'destino', oauth: false,
  campos: [
    { nome: 'token', rotulo: 'Token de acesso', segredo: true, obrigatorio: true, ajuda: 'Token longo (60 dias) com instagram_business_content_publish.' },
    { nome: 'igUserId', rotulo: 'ID da conta do Instagram', ajuda: 'Com token "IG..." o app descobre sozinho.' },
  ],
  passos: [
    'A conta precisa ser <b>profissional</b> (Criador de conteudo ou Empresa).',
    'Em <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com/apps</a>, crie um app (caso de uso: <b>Gerenciar mensagens e conteudo no Instagram</b>).',
    'No produto <b>Instagram &gt; Configuracao da API com login do Instagram</b>, adicione sua conta em <b>Gerar tokens de acesso</b> e copie o token (comeca com <code>IG</code>).',
    'Permissoes necessarias: <code>instagram_business_basic</code> e <code>instagram_business_content_publish</code>.',
    'Se voce ja tem o token do robo do @alertatcg, pode colar o mesmo aqui.',
    'O token dura 60 dias. Quando vencer, gere outro e cole de novo.',
  ],
  async testar(cred, ctx) {
    if (!cred.token) throw new Error('Cole o token de acesso.');
    const id = await contaId(cred, ctx);
    const { dados } = await pedir(host(cred) + '/' + VERSAO + '/' + id + '?fields=username&access_token=' + encodeURIComponent(cred.token), { rotulo: 'Instagram' });
    let cota = '';
    try {
      const q = await pedir(host(cred) + '/' + VERSAO + '/' + id + '/content_publishing_limit?fields=quota_usage,config&access_token=' + encodeURIComponent(cred.token), { rotulo: 'Instagram' });
      const d = q.dados.data && q.dados.data[0];
      if (d) cota = ' (' + (d.quota_usage || 0) + '/' + ((d.config && d.config.quota_total) || 100) + ' posts nas ultimas 24h)';
    } catch (e) { /* cota e so informativa */ }
    return { conta: '@' + dados.username + cota };
  },
  avisos(info) {
    const a = [];
    if (info.altura <= info.largura) a.push('Reels ficam melhores em 9:16. Use "Preparar > Vertical" antes.');
    if (info.duracao < 3) a.push('Reels precisam de pelo menos 3 segundos.');
    if (info.duracao > 900) a.push('Reels pela API aceitam ate 15 minutos.');
    if (info.tamanho > 300 * 1048576) a.push('Arquivo passa de 300 MB, limite da API.');
    return a;
  },
  // So funciona com token de Pagina (EAA...) que tenha instagram_manage_contents.
  async apagar(cred, { id }) {
    try {
      await pedir(host(cred) + '/' + VERSAO + '/' + id + '?access_token=' + encodeURIComponent(cred.token), { method: 'DELETE', rotulo: 'Instagram' });
    } catch (e) {
      if (/permiss|(#10)|(#200)|403/i.test(e.message)) {
        throw new Error('O Instagram precisa da permissao instagram_manage_contents pra apagar. Gere o token do Explorer de novo marcando ela e salve no cartao do Facebook; depois tente de novo.');
      }
      throw e;
    }
  },
  // Seguidores + curtidas/comentarios dos ultimos posts. Visualizacoes precisam
  // da permissao instagram_manage_insights no token; sem ela vem so o resto.
  async metricas(cred, ctx) {
    const id = await contaId(cred, ctx);
    const base = host(cred) + '/' + VERSAO;
    const tk = '&access_token=' + encodeURIComponent(cred.token);
    const { dados: conta } = await pedir(base + '/' + id + '?fields=username,followers_count,follows_count,media_count' + tk, { rotulo: 'Instagram' });
    const { dados: m } = await pedir(base + '/' + id + '/media?fields=id,caption,media_product_type,permalink,timestamp,like_count,comments_count&limit=25' + tk, { rotulo: 'Instagram' });
    const posts = (m.data || []).map((x) => ({
      id: x.id, titulo: String(x.caption || '').split('\n')[0].slice(0, 120), url: x.permalink, data: x.timestamp,
      views: null, curtidas: x.like_count, comentarios: x.comments_count, tipo: x.media_product_type === 'REELS' ? 'reel' : 'post',
    }));
    const avisos = [];
    let semPermissao = false;
    await Promise.all(posts.map(async (p) => {
      if (semPermissao) return;
      try {
        const { dados: ins } = await pedir(base + '/' + p.id + '/insights?metric=views,shares,saved' + tk, { rotulo: 'Instagram' });
        for (const it of ins.data || []) {
          const val = it.values && it.values[0] ? it.values[0].value : it.total_value && it.total_value.value;
          if (it.name === 'views') p.views = val;
          if (it.name === 'shares') p.compartilhamentos = val;
          if (it.name === 'saved') p.salvos = val;
        }
      } catch (e) {
        if (/permiss|\(#10\)|\(#200\)|403/i.test(e.message)) semPermissao = true;
      }
    }));
    if (semPermissao) avisos.push('Visualizacoes do Instagram precisam da permissao instagram_manage_insights: gere o token do Explorer de novo marcando ela e salve no cartao do Facebook.');
    return { conta: { seguidores: conta.followers_count, seguindo: conta.follows_count, videos: conta.media_count }, posts, avisos };
  },
  // Novos seguidores e quem deixou de seguir, por dia (precisa instagram_manage_insights).
  async seguidoresPorDia(cred, ctx, dias = 14) {
    const id = await contaId(cred, ctx);
    const base = host(cred) + '/' + VERSAO + '/' + id + '/insights';
    const tk = '&access_token=' + encodeURIComponent(cred.token);
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const lista = [];
    let semPermissao = false;
    // o Instagram so separa "seguiu" de "deixou de seguir" por periodo: um pedido por dia
    await Promise.all([...Array(dias)].map(async (_, k) => {
      const fimDia = new Date(hoje.getTime() - k * 86400000);
      const iniDia = new Date(fimDia.getTime() - 86400000);
      try {
        const { dados } = await pedir(base + '?metric=follows_and_unfollows&period=day&metric_type=total_value&breakdown=follow_type' +
          '&since=' + Math.floor(iniDia / 1000) + '&until=' + Math.floor(fimDia / 1000) + tk, { rotulo: 'Instagram' });
        const res = (((dados.data || [])[0] || {}).total_value || {}).breakdowns || [];
        const valores = ((res[0] || {}).results || []);
        const pega = (t) => { const r = valores.find((x) => (x.dimension_values || [])[0] === t); return r ? r.value : 0; };
        lista.push({ dia: iniDia.toISOString().slice(0, 10), ganhos: pega('FOLLOWER'), perdas: pega('NON_FOLLOWER') });
      } catch (e) {
        if (/permiss|\(#10\)|\(#200\)|403/i.test(e.message)) semPermissao = true;
      }
    }));
    if (semPermissao && !lista.length) return { dias: [], aviso: 'Pra ver seguidores novos e quem saiu no Instagram: gere o token do Explorer com instagram_manage_insights e salve no cartao do Facebook.' };
    return { dias: lista.sort((a, b) => a.dia.localeCompare(b.dia)) };
  },

  async comentarios(cred, ctx) {
    const id = await contaId(cred, ctx);
    const base = host(cred) + '/' + VERSAO;
    const tk = '&access_token=' + encodeURIComponent(cred.token);
    const { dados: eu } = await pedir(base + '/' + id + '?fields=username' + tk, { rotulo: 'Instagram' });
    const { dados: m } = await pedir(base + '/' + id + '/media?fields=id,caption,permalink,comments_count&limit=12' + tk, { rotulo: 'Instagram' });
    const saida = [];
    await Promise.all((m.data || []).filter((x) => x.comments_count).map(async (post) => {
      try {
        const { dados: c } = await pedir(base + '/' + post.id + '/comments?fields=id,text,username,from{id,username},timestamp,like_count,hidden,replies{id,text,username,from{id,username},timestamp}&limit=30' + tk, { rotulo: 'Instagram' });
        for (const x of c.data || []) {
          const nomeDe = (y) => y.username || (y.from && y.from.username) || null;
          const respostas = ((x.replies && x.replies.data) || []).map((r) => ({ autor: nomeDe(r) || 'Alguém', texto: r.text, data: r.timestamp, minha: nomeDe(r) === eu.username }));
          saida.push({
            id: x.id, autor: nomeDe(x) || 'Alguém', texto: x.text, data: x.timestamp, curtidas: x.like_count, oculto: !!x.hidden,
            post: String(post.caption || 'Post').split('\n')[0].slice(0, 80), url: post.permalink,
            respostas, respondido: respostas.some((r) => r.minha), meu: nomeDe(x) === eu.username,
          });
        }
      } catch (e) { /* post sem permissao de comentario */ }
    }));
    return { comentarios: saida, acoes: ['responder', 'ocultar'] };
  },

  async responderComentario(cred, ctx, id, texto) {
    try {
      await pedir(host(cred) + '/' + VERSAO + '/' + id + '/replies', { method: 'POST', rotulo: 'Instagram', form: { message: texto, access_token: cred.token } });
    } catch (e) {
      if (/permiss|\(#10\)|\(#200\)|403/i.test(e.message)) throw new Error('Falta a permissao instagram_manage_comments no token (gere de novo no Explorer e salve no cartao do Facebook).');
      throw e;
    }
  },
  async ocultarComentario(cred, ctx, id, ocultar = true) {
    await pedir(host(cred) + '/' + VERSAO + '/' + id, { method: 'POST', rotulo: 'Instagram', form: { hide: ocultar ? 'true' : 'false', access_token: cred.token } });
  },

  async postar(cred, { arquivo, info, opcoes, capa }, log, ctx) {
    const id = await contaId(cred, ctx);
    const base = host(cred) + '/' + VERSAO;
    log('Criando o Reel');
    const { dados: cont } = await pedir(base + '/' + id + '/media', {
      method: 'POST', rotulo: 'Instagram',
      form: {
        media_type: 'REELS', upload_type: 'resumable', caption: String(opcoes.legenda || '').slice(0, 2200),
        share_to_feed: opcoes.feed === false ? 'false' : 'true', access_token: cred.token,
        // o Instagram so aceita escolher o quadro do video como capa pela API
        thumb_offset: String(Math.max(0, Math.round((Number((capa || {}).segundos) || 0) * 1000))),
      },
    });
    log('Enviando o video (' + Math.round(info.tamanho / 1048576) + ' MB)');
    await pedir('https://rupload.facebook.com/ig-api-upload/' + VERSAO + '/' + cont.id, {
      method: 'POST', rotulo: 'Instagram (upload)', timeout: 3600000,
      headers: { Authorization: 'OAuth ' + cred.token, offset: '0', file_size: String(info.tamanho), 'Content-Type': 'application/octet-stream' },
      body: await arquivoBlob(arquivo, 'application/octet-stream'),
    });
    log('Instagram processando o video');
    for (let i = 0; i < 80; i++) {
      const { dados: st } = await pedir(base + '/' + cont.id + '?fields=status_code,status&access_token=' + encodeURIComponent(cred.token), { rotulo: 'Instagram' });
      if (st.status_code === 'FINISHED') break;
      if (st.status_code === 'ERROR') throw new Error('Instagram recusou o video: ' + (st.status || 'sem detalhe'));
      if (st.status_code === 'EXPIRED') throw new Error('O envio expirou. Tente de novo.');
      if (i === 79) throw new Error('Instagram ainda processando depois de 20 min. Veja no app se o Reel apareceu.');
      await espera(15000);
    }
    log('Publicando');
    const { dados: pub } = await pedir(base + '/' + id + '/media_publish', {
      method: 'POST', rotulo: 'Instagram', form: { creation_id: cont.id, access_token: cred.token },
    });
    let url;
    try {
      const { dados: m } = await pedir(base + '/' + pub.id + '?fields=permalink&access_token=' + encodeURIComponent(cred.token), { rotulo: 'Instagram' });
      url = m.permalink;
    } catch (e) { /* o post saiu; so o link que falhou */ }
    return { id: pub.id, url };
  },
};
