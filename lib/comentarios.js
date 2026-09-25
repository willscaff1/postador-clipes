// Caixa de comentarios: junta os comentarios recentes das redes que deixam
// ler e responder pela API (YouTube, Instagram, Facebook) e executa as acoes.
//   TikTok: a API de comentarios so existe pra pesquisa academica.
//   X: ler e responder gasta credito da API paga.
const cofre = require('./cofre');
const plataformas = require('./plataformas');
const { esconder } = require('./http');

const REDES = ['youtube', 'instagram', 'facebook'];
const VALIDADE = 3 * 60000;
let cache = null;

const ctx = (id) => ({ salvar: (c) => cofre.atualizar(id, c) });
const comPrazo = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('demorou demais pra responder')), ms))]);

async function listar({ atualizar } = {}) {
  if (cache && !atualizar && Date.now() - cache.em < VALIDADE) return cache;
  const ligadas = Object.fromEntries(plataformas.resumo(0).map((p) => [p.id, p.conectado]));
  const redes = {};
  const todos = [];
  await Promise.all(REDES.filter((id) => ligadas[id]).map(async (id) => {
    const m = plataformas.obter(id);
    try {
      const r = await comPrazo(m.comentarios(cofre.obter(id), ctx(id)), 60000);
      redes[id] = { ok: true, acoes: r.acoes, total: r.comentarios.length };
      for (const c of r.comentarios) if (!c.meu) todos.push({ ...c, plat: id });
    } catch (e) {
      redes[id] = { ok: false, erro: esconder(e.message) };
    }
  }));
  todos.sort((a, b) => String(b.data).localeCompare(String(a.data)));
  cache = { em: Date.now(), redes, comentarios: todos.slice(0, 300), semSuporte: { tiktok: 'A API de comentários do TikTok não é liberada pra apps de postagem.', x: 'No X, ler e responder comentários gasta crédito da API paga.' } };
  return cache;
}

async function agir(plat, id, acao, { texto, valor } = {}) {
  if (!REDES.includes(plat)) throw new Error('Essa rede nao tem comentarios pelo painel.');
  const m = plataformas.obter(plat);
  const cred = cofre.obter(plat);
  if (acao === 'responder') {
    const t = String(texto || '').trim();
    if (!t) throw new Error('Escreva a resposta.');
    if (t.length > 2000) throw new Error('Resposta longa demais.');
    await m.responderComentario(cred, ctx(plat), id, t);
  } else if (acao === 'curtir') {
    if (!m.curtirComentario) throw new Error((m.nome || plat) + ' nao deixa curtir comentario pela API.');
    await m.curtirComentario(cred, ctx(plat), id, valor !== false);
  } else if (acao === 'ocultar') {
    if (!m.ocultarComentario) throw new Error((m.nome || plat) + ' nao deixa ocultar comentario pela API.');
    await m.ocultarComentario(cred, ctx(plat), id, valor !== false);
  } else throw new Error('Acao desconhecida.');
  // atualiza o comentario na memoria pra tela refletir na hora
  if (cache) {
    const c = cache.comentarios.find((x) => x.plat === plat && x.id === id);
    if (c && acao === 'responder') { c.respondido = true; c.respostas = [...(c.respostas || []), { autor: 'Você', texto: String(texto).trim(), data: new Date().toISOString(), minha: true }]; }
    if (c && acao === 'curtir') c.curti = valor !== false;
    if (c && acao === 'ocultar') c.oculto = valor !== false;
  }
  return { ok: true };
}

module.exports = { listar, agir };
