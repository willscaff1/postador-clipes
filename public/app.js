'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const estado = { plataformas: [], ferramentas: {}, clipes: [], postagens: [], clipeId: null, avisos: {}, pasta: null };
const NOMES_PLAT = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', x: 'X', twitch: 'Twitch', kick: 'Kick' };

async function api(metodo, url, corpo) {
  const r = await fetch(url, {
    method: metodo,
    headers: { 'X-Postador': '1', ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || 'Erro ' + r.status);
  return j;
}

let toastTimer;
function toast(msg, erro) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (erro ? ' erro' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, erro ? 7000 : 3500);
}

function tempo(s) {
  s = Math.round(Number(s) || 0);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function mb(b) { return (b / 1048576).toFixed(b > 100 * 1048576 ? 0 : 1) + ' MB'; }
function quando(iso) { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }

// ---------- abas ----------

const PAGINAS = {
  clipes: ['Clipes', 'Traga clipes do PC, da Twitch ou de um link.'],
  postar: ['Postar', 'Escolha as redes, ajuste o texto e a capa, confira e publique.'],
  historico: ['Histórico', 'Tudo que foi enviado, rede por rede.'],
  lives: ['Lives', 'Suas lives da Twitch e da Kick: assista, marque o lance e vire clipe.'],
  estudio: ['Estúdio', 'Vídeos longos automáticos pro YouTube e clipes, direto das suas lives.'],
  metricas: ['Métricas', 'Seguidores, views e o desempenho de cada post, por rede ou somando tudo.'],
  contas: ['Contas', 'Conecte e teste cada rede.'],
};

// lives.js e metricas.js se penduram aqui pra carregar quando a aba abre
const aoAbrirAba = {};

function irPara(aba) {
  $$('.abas button').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
  $$('.aba').forEach((s) => { s.hidden = s.id !== 'aba-' + aba; });
  const [titulo, sub] = PAGINAS[aba] || ['', ''];
  $('#tituloPagina').textContent = titulo;
  $('#subtituloPagina').textContent = sub;
  document.title = titulo + ' · Postador de Clipes';
  document.body.classList.remove('menu-aberto');
  if (location.hash !== '#' + aba) history.replaceState(null, '', '#' + aba);
  if (aba === 'postar') desenharPostar();
  if (aoAbrirAba[aba]) aoAbrirAba[aba]();
  window.scrollTo(0, 0);
}
$$('.abas button').forEach((b) => b.addEventListener('click', () => irPara(b.dataset.aba)));
$('#abrirMenu').addEventListener('click', () => document.body.classList.add('menu-aberto'));
$('#veu').addEventListener('click', () => document.body.classList.remove('menu-aberto'));

// Bolinha de status de cada rede na barra lateral; clicar leva pra Contas.
function desenharRedesLateral() {
  $('#redesLateral').innerHTML = estado.plataformas.filter((p) => p.tipo === 'destino' || p.conectado).map((p) => {
    const st = !p.conectado ? 'off' : p.teste && !p.teste.ok ? 'erro' : p.teste ? 'ok' : 'pendente';
    const titulo = { off: 'não configurado', erro: 'último teste falhou', ok: 'conectado', pendente: 'não testado' }[st];
    return `<li><button data-ir-conta="${p.id}" title="${esc(p.nome)}: ${titulo}"><i class="bolinha ${st}"></i>${esc(p.nome)}</button></li>`;
  }).join('');
}
$('#redesLateral').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ir-conta]');
  if (!b) return;
  irPara('contas');
  const cartao = $(`.conta[data-plat="${b.dataset.irConta}"]`);
  if (cartao) cartao.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$$('.subabas button').forEach((b) => b.addEventListener('click', () => {
  $$('.subabas button').forEach((x) => x.classList.toggle('ativa', x === b));
  $$('[data-fonte-painel]').forEach((p) => { p.hidden = p.dataset.fontePainel !== b.dataset.fonte; });
}));

// ---------- estado geral ----------

async function carregarEstado() {
  const e = await api('GET', '/api/estado');
  estado.plataformas = e.plataformas;
  estado.ferramentas = e.ferramentas;
  const faltas = [];
  if (!e.ferramentas.ffmpeg) faltas.push('ffmpeg não encontrado — sem ele não dá pra converter nem preparar clipes. Instale com <code>winget install Gyan.FFmpeg</code> e reinicie.');
  $('#avisoFerramentas').innerHTML = faltas.join('<br>');
  $('#avisoFerramentas').hidden = !faltas.length;
  if (!e.ferramentas.ytdlp) $('#dicaLink').innerHTML = 'Clipe da Twitch baixa direto na melhor qualidade. Pra YouTube, Kick, VOD e outros sites instale o yt-dlp: <code>winget install yt-dlp.yt-dlp</code> e reinicie o app.';
  const tw = estado.plataformas.find((p) => p.id === 'twitch');
  const canal = tw && tw.campos.find((c) => c.nome === 'canalPadrao');
  if (canal && canal.valor && !$('#canalTwitch').value) $('#canalTwitch').value = canal.valor;
  $('#dicaTwitch').textContent = tw && tw.conectado ? 'Twitch conectada' + (canal && canal.valor ? ' (' + canal.valor + ')' : '') + '.' : 'Funciona sem conectar. Na aba Contas dá pra ligar sua conta da Twitch.';
  const destinos = estado.plataformas.filter((p) => p.tipo === 'destino');
  const ok = destinos.filter((p) => p.conectado && p.teste && p.teste.ok).length;
  $('#contagemContas').textContent = ok + '/' + destinos.length;
  desenharRedesLateral();
  desenharContas();
}

// ---------- contas ----------

function statusConta(p) {
  if (!p.configurado && !Object.values(p.campos).some((c) => c.salvo)) return ['', p.opcional ? 'opcional' : 'não configurado'];
  if (p.oauth && !p.conectado) return ['pendente', 'falta conectar'];
  if (!p.conectado) return ['pendente', 'incompleto'];
  if (!p.teste) return ['pendente', 'não testado'];
  return p.teste.ok ? ['ok', 'conectado'] : ['erro', 'com erro'];
}

function desenharContas() {
  const alvo = $('#contas');
  const abertos = new Set($$('details[open]', alvo).map((d) => d.dataset.plat));
  alvo.innerHTML = estado.plataformas.map((p) => {
    const [cls, rotulo] = statusConta(p);
    const campos = p.campos.filter((c) => !c.automatico || c.salvo).map((c) => `
      <label class="campo">${esc(c.rotulo)}${c.obrigatorio ? '' : ' <small>(opcional)</small>'}
        <input name="${c.nome}" ${c.segredo ? 'type="password" autocomplete="new-password"' : 'autocomplete="off"'}
          value="${esc(c.valor)}" placeholder="${c.salvo && c.segredo ? esc(c.mascara) + ' (salvo — deixe vazio pra manter)' : ''}"
          ${c.automatico ? 'readonly' : ''}>
        ${c.ajuda ? `<small>${esc(c.ajuda)}</small>` : ''}
      </label>`).join('');
    const teste = p.teste ? `<div class="resultado-teste ${p.teste.ok ? 'ok' : 'erro'}">
        ${p.teste.ok ? '✓ ' + esc(p.teste.conta) : '✗ ' + esc(p.teste.mensagem)}
        <br><small>testado em ${quando(p.teste.quando)}</small></div>` : '';
    return `<article class="conta" data-plat="${p.id}">
      <header><h3>${esc(p.nome)}${p.tipo === 'fonte' ? ' <small class="dica">(fonte de clipes)</small>' : ''}</h3><span class="status ${cls}">${rotulo}</span></header>
      <details data-plat="${p.id}" ${abertos.has(p.id) ? 'open' : ''}>
        <summary>Como conseguir as credenciais</summary>
        <ol>${p.passos.map((s) => '<li>' + s + '</li>').join('')}</ol>
      </details>
      ${p.redirect ? `<div class="redirect"><span>Redirecionamento:</span><code>${esc(p.redirect)}</code><button class="sec mini" data-copiar="${esc(p.redirect)}">Copiar</button></div>` : ''}
      <form class="form-conta">${campos}</form>
      ${teste}
      <div class="botoes">
        <button data-acao="salvar">Salvar${p.oauth ? '' : ' e testar'}</button>
        ${p.oauth ? `<button data-acao="conectar" class="sec" ${p.campos.filter((c) => c.obrigatorio).every((c) => c.salvo) ? '' : 'disabled title="Salve o ID e o segredo primeiro"'}>${p.conectado ? 'Reconectar' : 'Conectar'}</button>` : ''}
        <button data-acao="testar" class="sec" ${p.conectado ? '' : 'disabled'}>Testar conexão</button>
        ${p.configurado || p.campos.some((c) => c.salvo) ? '<button data-acao="remover" class="perigo">Remover</button>' : ''}
      </div>
    </article>`;
  }).join('');
}

$('#contas').addEventListener('click', async (ev) => {
  const copiar = ev.target.closest('[data-copiar]');
  if (copiar) { navigator.clipboard.writeText(copiar.dataset.copiar).then(() => toast('Copiado')); return; }
  const b = ev.target.closest('button[data-acao]');
  if (!b) return;
  const card = b.closest('.conta');
  const plat = card.dataset.plat;
  const nome = estado.plataformas.find((p) => p.id === plat).nome;
  const texto = b.textContent;
  b.disabled = true;
  try {
    if (b.dataset.acao === 'salvar') {
      const campos = {};
      $$('input[name]', card).forEach((i) => { if (!i.readOnly) campos[i.name] = i.value; });
      b.textContent = 'Salvando…';
      const r = await api('POST', '/api/contas/' + plat, { campos });
      const partes = [];
      let falhou = false;
      if (r.teste) { partes.push(r.teste.ok ? nome + ': conectado como ' + r.teste.conta : nome + ': ' + r.teste.mensagem); falhou = !r.teste.ok; }
      for (const [outra, t] of Object.entries(r.outros || {})) {
        const n = (estado.plataformas.find((p) => p.id === outra) || {}).nome || outra;
        partes.push(t.ok ? n + ' configurado junto: ' + t.conta : n + ': ' + t.mensagem);
        falhou = falhou || !t.ok;
      }
      if (partes.length) toast(partes.join(' · '), falhou);
      else toast(nome + ': salvo' + (estado.plataformas.find((p) => p.id === plat).oauth ? '. Agora clique em Conectar.' : '.'));
    } else if (b.dataset.acao === 'testar') {
      b.textContent = 'Testando…';
      const r = await api('POST', '/api/contas/' + plat + '/testar');
      toast(r.ok ? nome + ': conectado como ' + r.conta : nome + ': ' + r.mensagem, !r.ok);
    } else if (b.dataset.acao === 'conectar') {
      location.href = '/oauth/' + plat + '/iniciar';
      return;
    } else if (b.dataset.acao === 'remover') {
      if (!confirm('Remover as credenciais de ' + nome + ' deste PC?')) return;
      await api('DELETE', '/api/contas/' + plat);
      toast(nome + ': credenciais removidas');
    }
    await carregarEstado();
  } catch (e) {
    toast(e.message, true);
  } finally {
    b.disabled = false;
    b.textContent = texto;
  }
});

// ---------- biblioteca ----------

async function carregarClipes() {
  estado.clipes = await api('GET', '/api/clipes');
  desenharBiblioteca();
  if (estado.aguardando) {
    const c = estado.clipes.find((x) => x.id === estado.aguardando);
    if (!c || c.estado !== 'processando') {
      estado.aguardando = null;
      if (c && c.estado === 'pronto') { escolherClipe(c.id); irPara('postar'); toast('Clipe pronto: escolha onde postar.'); }
      else toast('Não deu pra trazer o clipe: ' + (c ? c.erro : 'sumiu da lista'), true);
    }
    if (!$('#aba-postar').hidden) desenharPostar();
  }
  if (estado.clipes.some((c) => c.estado === 'processando')) setTimeout(carregarClipes, 1200);
}

// Redes onde o clipe já saiu (ou está saindo), somando todas as postagens dele.
function redesPostadas(clipeId) {
  const s = new Set();
  for (const p of estado.postagens || []) {
    if (p.clipeId !== clipeId) continue;
    for (const [plat, d] of Object.entries(p.destinos)) if (['ok', 'enviando', 'na fila'].includes(d.estado)) s.add(plat);
  }
  return s;
}

// Abre a tela de postar com o clipe e já marca as redes conectadas onde ele ainda não saiu.
function postarNasOutras(clipeId, postagem) {
  const c = estado.clipes.find((x) => x.id === clipeId);
  if (!c || c.estado !== 'pronto') return toast('O arquivo desse clipe não está mais na biblioteca.', true);
  const feitas = redesPostadas(clipeId);
  const faltam = estado.plataformas.filter((p) => p.tipo === 'destino' && p.conectado && !feitas.has(p.id)).map((p) => p.id);
  if (!faltam.length) toast('Esse clipe já saiu em todas as redes conectadas.');
  estado.preMarcar = faltam;
  escolherClipe(clipeId);
  // reaproveita o gancho do post anterior (primeira linha da legenda)
  const anterior = postagem || (estado.postagens || []).find((p) => p.clipeId === clipeId);
  const d = anterior && Object.values(anterior.destinos).find((x) => x.opcoes && (x.opcoes.titulo || x.opcoes.legenda || x.opcoes.texto));
  if (d) {
    const gancho = d.opcoes.titulo || String(d.opcoes.legenda || d.opcoes.texto).split('\n')[0];
    if (gancho) { $('#titulo').value = gancho.trim(); $('#legenda').value = ''; }
  }
  irPara('postar');
}

function desenharBiblioteca() {
  const alvo = $('#biblioteca');
  const prontos = estado.clipes.filter((c) => c.estado === 'pronto').length;
  $('#totalClipes').textContent = estado.clipes.length ? prontos + ' pronto(s)' : '';
  if (!estado.clipes.length) {
    alvo.innerHTML = '<div class="vazio" style="grid-column:1/-1">Nenhum clipe ainda. Traga um do PC, da Twitch ou de um link.</div>';
    return;
  }
  const origem = { pc: 'PC', twitch: 'Twitch', kick: 'Kick', link: 'Link', preparado: 'Preparado' };
  alvo.innerHTML = estado.clipes.map((c) => {
    const i = c.info || {};
    const capa = c.temMiniatura ? `<img src="/midia/${c.id}/miniatura?v=${encodeURIComponent(c.criadoEm)}" alt="" loading="lazy">` : '<span class="dica">' + (c.estado === 'erro' ? '✗' : '<i class="giro"></i>') + '</span>';
    let meta;
    if (c.estado === 'processando') meta = `${esc(c.etapa || 'processando')}${c.progresso ? ' — ' + c.progresso + '%' : ''}<div class="barra"><i style="width:${c.progresso || 3}%"></i></div>`;
    else if (c.estado === 'erro') meta = esc(c.erro);
    else meta = `${i.largura}×${i.altura} · ${mb(i.tamanho)}${i.altura > i.largura ? ' · vertical' : ''}`;
    const feitas = [...redesPostadas(c.id)];
    const postado = feitas.length ? `<div class="postado-em">✓ Postado: ${feitas.map((p) => NOMES_PLAT[p] || p).join(', ')}</div>` : '';
    return `<article class="clipe ${c.estado}" data-id="${c.id}">
      <div class="capa">${capa}<span class="tag">${origem[c.origem] || c.origem}</span>${i.duracao ? `<span class="dur">${tempo(i.duracao)}</span>` : ''}</div>
      <div class="corpo">
        <div class="nome" title="Clique pra renomear" data-acao="renomear">${esc(c.nome)}</div>
        <div class="meta">${meta}</div>
        ${postado}
        <div class="botoes">
          ${c.estado === 'pronto' ? (feitas.length ? '<button class="mini" data-acao="outras">Postar nas outras redes</button>' : '<button class="mini" data-acao="postar">Postar</button>') + '<button class="mini sec" data-acao="preparar">Preparar</button>' : ''}
          ${postadosDoClipe(c.id).length ? '<button class="mini perigo" data-acao="apagar-redes">Apagar das redes</button>' : ''}
          <button class="mini perigo" data-acao="excluir" title="Tira da lista deste PC; não apaga nada nas redes">Excluir</button>
        </div>
      </div>
    </article>`;
  }).join('');
}

$('#biblioteca').addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-acao]');
  if (!el) return;
  const id = el.closest('.clipe').dataset.id;
  const c = estado.clipes.find((x) => x.id === id);
  try {
    if (el.dataset.acao === 'postar') { escolherClipe(id); irPara('postar'); }
    else if (el.dataset.acao === 'outras') postarNasOutras(id);
    else if (el.dataset.acao === 'apagar-redes') abrirApagar(postadosDoClipe(id), c.nome);
    else if (el.dataset.acao === 'preparar') abrirPreparar(c);
    else if (el.dataset.acao === 'renomear') {
      const nome = prompt('Nome do clipe', c.nome);
      if (nome && nome !== c.nome) { await api('PATCH', '/api/clipes/' + id, { nome }); await carregarClipes(); }
    } else if (el.dataset.acao === 'excluir') {
      const msg = c.arquivoLocal ? 'Tirar "' + c.nome + '" da lista? O arquivo original no PC não é apagado.' : 'Excluir "' + c.nome + '"?';
      if (!confirm(msg)) return;
      await api('DELETE', '/api/clipes/' + id);
      if (estado.clipeId === id) estado.clipeId = null;
      await carregarClipes();
    }
  } catch (e) { toast(e.message, true); }
});

// ---------- fonte: PC (upload) ----------

function enviarArquivo(arquivo) {
  const linha = document.createElement('div');
  linha.className = 'envio';
  linha.innerHTML = `${esc(arquivo.name)} — <span>0%</span><div class="barra"><i></i></div>`;
  $('#envios').append(linha);
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open('PUT', '/api/clipes/enviar?nome=' + encodeURIComponent(arquivo.name));
    x.setRequestHeader('X-Postador', '1');
    x.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const p = Math.round((e.loaded / e.total) * 100);
      $('span', linha).textContent = p + '%';
      $('i', linha).style.width = p + '%';
    };
    x.onload = () => {
      if (x.status >= 400) { let m = 'erro'; try { m = JSON.parse(x.responseText).erro; } catch (e) { /* */ } toast(arquivo.name + ': ' + m, true); }
      linha.remove();
      carregarClipes();
      resolve();
    };
    x.onerror = () => { toast('Falha ao enviar ' + arquivo.name, true); linha.remove(); resolve(); };
    x.send(arquivo);
  });
}

$('#arquivo').addEventListener('change', async (e) => {
  for (const f of e.target.files) await enviarArquivo(f);
  e.target.value = '';
});
const soltar = $('#soltar');
['dragenter', 'dragover'].forEach((t) => soltar.addEventListener(t, (e) => { e.preventDefault(); soltar.classList.add('sobre'); }));
['dragleave', 'drop'].forEach((t) => soltar.addEventListener(t, () => soltar.classList.remove('sobre')));
soltar.addEventListener('drop', async (e) => {
  e.preventDefault();
  for (const f of e.dataTransfer.files) await enviarArquivo(f);
});

// ---------- fonte: pasta do PC ----------

async function abrirPasta(pasta) {
  try {
    const r = await api('GET', '/api/pc' + (pasta ? '?pasta=' + encodeURIComponent(pasta) : ''));
    estado.pasta = r;
    $('#pastaPc').value = r.pasta;
    $('#subirPasta').disabled = !r.acima;
    $('#listaPasta').innerHTML = r.itens.length ? r.itens.map((i) => i.pasta
      ? `<li class="pasta"><span class="nome" data-entrar="${esc(i.nome)}">${esc(i.nome)}</span></li>`
      : `<li><span class="nome" title="${esc(i.nome)}">${esc(i.nome)}</span><span class="dica">${mb(i.tamanho)} · ${quando(i.modificado)}</span><button class="mini" data-importar="${esc(i.nome)}">Usar</button></li>`).join('')
      : '<li class="dica">Nenhum vídeo nesta pasta.</li>';
  } catch (e) { toast(e.message, true); }
}
const sep = (p) => (p.endsWith('\\') || p.endsWith('/') ? p : p + '\\');
$('#navegadorPc').addEventListener('toggle', (e) => { if (e.target.open && !estado.pasta) abrirPasta(); });
$('#abrirPasta').addEventListener('click', () => abrirPasta($('#pastaPc').value));
$('#pastaPc').addEventListener('keydown', (e) => { if (e.key === 'Enter') abrirPasta($('#pastaPc').value); });
$('#subirPasta').addEventListener('click', () => estado.pasta && estado.pasta.acima && abrirPasta(estado.pasta.acima));
$('#listaPasta').addEventListener('click', async (e) => {
  const entrar = e.target.closest('[data-entrar]');
  if (entrar) return abrirPasta(sep(estado.pasta.pasta) + entrar.dataset.entrar);
  const imp = e.target.closest('[data-importar]');
  if (!imp) return;
  imp.disabled = true;
  try {
    await api('POST', '/api/clipes/importar', { caminho: sep(estado.pasta.pasta) + imp.dataset.importar });
    toast('Adicionado: ' + imp.dataset.importar);
    await carregarClipes();
  } catch (err) { toast(err.message, true); imp.disabled = false; }
});

// ---------- fonte: Twitch ----------

$('#formTwitch').addEventListener('submit', async (e) => {
  e.preventDefault();
  const alvo = $('#clipesTwitch');
  const b = $('button', e.target);
  b.disabled = true;
  alvo.innerHTML = '<p class="dica"><i class="giro"></i>Buscando…</p>';
  try {
    const lista = await api('GET', '/api/twitch/clipes?canal=' + encodeURIComponent($('#canalTwitch').value) + '&dias=' + $('#diasTwitch').value);
    alvo.innerHTML = lista.length ? lista.map((c) => `<div class="clipe-tw">
        <img src="${esc(c.miniatura)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <div><b>${esc(c.titulo)}</b>
          <span class="dica">${Number(c.views).toLocaleString('pt-BR')} views · ${tempo(c.duracao)} · ${quando(c.criadoEm)}${c.autor ? ' · por ' + esc(c.autor) : ''}${c.temVertical ? ' · <b>tem vertical</b>' : ''}</span>
          <button class="mini" data-link="${esc(c.url)}" data-nome="${esc(c.titulo)}">Trazer</button></div>
      </div>`).join('') : '<p class="dica">Nenhum clipe nesse período.</p>';
  } catch (err) { alvo.innerHTML = ''; toast(err.message, true); }
  b.disabled = false;
});
$('#clipesTwitch').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-link]');
  if (!b) return;
  b.disabled = true;
  b.textContent = 'Baixando…';
  try {
    await api('POST', '/api/clipes/link', { url: b.dataset.link, nome: b.dataset.nome, vertical: $('#verticalTwitch').checked });
    b.textContent = 'Na biblioteca ✓';
    carregarClipes();
  } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = 'Trazer'; }
});

// ---------- atalho: colar link da Twitch ou caminho do PC e ir direto pra postar ----------

$$('form[data-rapido]').forEach((form) => form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const campo = form.elements.valor;
  const b = $('button', form);
  const valor = campo.value.trim().replace(/^"|"$/g, '');
  b.disabled = true;
  try {
    const c = form.dataset.rapido === 'link'
      ? await api('POST', '/api/clipes/link', { url: valor, vertical: $('#verticalTwitch').checked })
      : await api('POST', '/api/clipes/importar', { caminho: valor });
    campo.value = '';
    estado.aguardando = c.id;
    estado.clipeId = null;
    $('#titulo').value = '';
    irPara('postar');
    await carregarClipes();
  } catch (err) { toast(err.message, true); }
  b.disabled = false;
}));

// ---------- fonte: link ----------

$('#formLink').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', '/api/clipes/link', { url: $('#urlLink').value });
    $('#urlLink').value = '';
    toast('Baixando… acompanhe em "Seus clipes".');
    carregarClipes();
  } catch (err) { toast(err.message, true); }
});

// ---------- preparar (cortar / vertical) ----------

let preparando = null;
function abrirPreparar(c) {
  preparando = c;
  $('#videoPreparar').src = '/midia/' + c.id + '/video';
  $('#prepInicio').value = 0;
  $('#prepFim').value = 0;
  const vertical = c.info && c.info.altura > c.info.largura;
  $(`input[name="formato"][value="${vertical ? 'original' : 'vertical-desfocado'}"]`).checked = true;
  const temModelo = !!(estado.ferramentas && estado.ferramentas.legendas);
  $('#prepLegenda').disabled = !temModelo;
  $('#prepLegenda').checked = false;
  $('#dicaLegenda').textContent = temModelo
    ? 'Roda offline no seu PC. Leva mais ou menos o tempo do clipe. Se o clipe vertical da Twitch já tiver legenda, deixe desligado pra não duplicar.'
    : 'Ainda não instalada: falta baixar o modelo de voz (Whisper).';
  $('#dlgPreparar').showModal();
}
$('#marcarInicio').addEventListener('click', () => { $('#prepInicio').value = $('#videoPreparar').currentTime.toFixed(1); });
$('#marcarFim').addEventListener('click', () => { $('#prepFim').value = $('#videoPreparar').currentTime.toFixed(1); });
$('#dlgPreparar').addEventListener('close', async () => {
  const v = $('#videoPreparar');
  v.pause();
  v.removeAttribute('src');
  v.load();
  if ($('#dlgPreparar').returnValue !== 'ok' || !preparando) return;
  try {
    await api('POST', '/api/clipes/' + preparando.id + '/preparar', {
      inicio: $('#prepInicio').value, fim: $('#prepFim').value, formato: $('input[name="formato"]:checked').value,
      legendas: $('#prepLegenda').checked, estiloLegenda: $('#prepEstilo').value, posicaoLegenda: $('#prepPosicao').value,
    });
    toast('Gerando o clipe novo…');
    carregarClipes();
  } catch (e) { toast(e.message, true); }
});

// ---------- postar ----------

// Campo de texto de uma rede: vem do texto base e acompanha ele até ser editado à mão.
// data-gerar diz de onde sai o valor; data-limite liga o contador.
function campoTexto(op, rotulo, { linhas = 3, limite, dica = '', gerar } = {}) {
  const el = linhas === 1
    ? `<input data-op="${op}" data-gerar="${gerar || op}" ${limite ? `data-limite="${limite}"` : ''}>`
    : `<textarea data-op="${op}" data-gerar="${gerar || op}" rows="${linhas}" ${limite ? `data-limite="${limite}"` : ''}></textarea>`;
  return `<label class="campo campo-rede">${rotulo} <span class="contador"></span>
    <button type="button" class="link-base" data-voltar-base hidden>↺ usar o texto base</button>
    ${dica ? `<small>${dica}</small>` : ''}${el}</label>`;
}

function clipeAtual() { return estado.clipes.find((x) => x.id === estado.clipeId); }
function ehShort() { const i = (clipeAtual() || {}).info || {}; return i.altura > i.largura && i.duracao <= 180; }

const opcoesPorPlat = {
  youtube: () => `
    <div class="tipo-post">${ehShort() ? '📱 Vai como <b>Short</b> (vertical, até 3 min)' : '🎬 Vai como <b>vídeo normal</b> (não é vertical de até 3 min)'}</div>
    ${campoTexto('titulo', 'Título', { linhas: 1, limite: 100, gerar: 'yt-titulo' })}
    ${campoTexto('descricao', 'Descrição', { linhas: 5, limite: 5000, gerar: 'yt-descricao' })}
    ${campoTexto('tags', 'Tags', { linhas: 1, limite: 500, gerar: 'yt-tags', dica: 'separadas por vírgula; ajudam a busca, não aparecem no vídeo' })}
    <div class="linha">
      <label class="campo">Visibilidade <select data-op="privacidade">
        <option value="public">Público</option><option value="unlisted">Não listado</option><option value="private">Privado</option></select></label>
      <label class="campo">Agendar publicação <small>(opcional)</small><input type="datetime-local" data-op="publicarEm"></label>
      <label class="campo">Categoria <select data-op="categoria">
        <option value="20">Jogos</option><option value="24">Entretenimento</option><option value="23">Comédia</option><option value="22">Pessoas e blogs</option></select></label>
    </div>
    <fieldset class="grupo"><legend>Público</legend>
      <label class="check"><input type="radio" name="ytCriancas" data-op="paraCriancas" value="nao" checked> Não, não é conteúdo para crianças</label>
      <label class="check"><input type="radio" name="ytCriancas" data-op="paraCriancas" value="sim"> Sim, é conteúdo para crianças <small>(desliga comentários e notificações)</small></label>
      <label class="check"><input type="checkbox" data-op="restricaoIdade"> Restringir para maiores de 18 anos <small>(palavrão pesado, violência realista…)</small></label>
    </fieldset>
    <label class="check"><input type="checkbox" data-op="shorts" checked ${ehShort() ? '' : 'disabled'}> Colocar #Shorts na descrição</label>
    <label class="check"><input type="checkbox" data-op="notificar" checked> Avisar os inscritos quando publicar</label>
    <p class="dica">Enquanto o projeto do Google não passa pela auditoria do YouTube, a API publica como <b>Privado</b>; o Histórico avisa e você libera no YouTube Studio.</p>`,
  instagram: () => `
    <div class="tipo-post">🎞️ Vai como <b>Reel</b> no @${esc(((estado.plataformas.find((p) => p.id === 'instagram') || {}).teste || {}).conta || '').replace(/^@/, '').split(' ')[0]}</div>
    ${campoTexto('legenda', 'Legenda', { linhas: 6, limite: 2200, gerar: 'completo', dica: 'o Instagram aceita até 30 hashtags' })}
    <div class="linha">
      <label class="check"><input type="checkbox" data-op="feed" checked> Mostrar também no feed (além da aba Reels)</label>
    </div>
    <p class="dica">Capa: o Instagram só aceita um quadro do vídeo pela API; vai o quadro escolhido em <b>Capa</b> (sem o texto). Dá pra trocar a capa depois no app.</p>`,
  // Tela no formato que o TikTok exige pra aprovar o Direct Post (auditoria):
  // conta visível, privacidade sem padrão, interações desmarcadas, divulgação comercial e aviso de música.
  tiktok: () => {
    const c = estado.tiktokCriador;
    if (!c) { carregarCriadorTikTok(); return '<p class="dica"><i class="giro"></i>Buscando sua conta do TikTok…</p>'; }
    if (c.erro) return `<div class="aviso-plat">⚠ ${esc(c.erro)}</div>`;
    const caixa = (op, rotulo, desligado) => `<label class="check ${desligado ? 'desligado' : ''}"><input type="checkbox" data-op="${op}" ${desligado ? 'disabled' : ''}> ${rotulo}${desligado ? ' <small>(desligado no seu perfil do TikTok)</small>' : ''}</label>`;
    return `
    <div class="tt-conta">${c.foto ? `<img src="${esc(c.foto)}" alt="" referrerpolicy="no-referrer">` : ''}<span>Postando como <b>${esc(c.apelido || '')}</b>${c.usuario ? ` (@${esc(c.usuario)})` : ''}</span></div>
    <label class="campo">Como enviar <select data-op="modo">
      <option value="rascunho">Mandar pro app e publicar pelo celular</option>
      <option value="direto">Publicar direto no perfil</option></select></label>
    <div class="tt-direto" hidden>
      <label class="campo">Quem pode ver este vídeo <small>(obrigatório)</small><select data-op="privacidade">
        <option value="">Escolha…</option>
        ${c.privacidades.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label>
      <div class="tt-interacoes"><b>Permitir que outras pessoas:</b>
        ${caixa('permitirComentario', 'Comentem', c.comentarioDesligado)}
        ${caixa('permitirDueto', 'Façam dueto', c.duetoDesligado)}
        ${caixa('permitirCostura', 'Façam costura', c.costuraDesligada)}
      </div>
      <label class="check"><input type="checkbox" data-op="comercial"> <b>Divulgar conteúdo comercial</b> <small>(o vídeo promove uma marca, produto ou serviço)</small></label>
      <div class="tt-comercial" hidden>
        <label class="check"><input type="checkbox" data-op="marcaPropria"> Sua marca <small>— o vídeo vai ser rotulado como "Conteúdo promocional"</small></label>
        <label class="check"><input type="checkbox" data-op="conteudoMarca"> Conteúdo de marca (parceria paga) <small>— rotulado como "Parceria paga"; não pode ser "Somente eu"</small></label>
      </div>
      <p class="dica tt-consentimento"></p>
      ${c.duracaoMaxima ? `<p class="dica">Sua conta aceita vídeos de até ${Math.floor(c.duracaoMaxima / 60)} min pela API.</p>` : ''}
    </div>
    ${campoTexto('legenda', 'Legenda', { linhas: 6, limite: 2200, gerar: 'completo', dica: 'no modo "pelo celular" o TikTok não recebe a legenda pela API: use o botão Copiar legenda do Histórico' })}`;
  },
  facebook: () => `
    <label class="campo">Tipo <select data-op="modo"><option value="reel">Reel (vertical, 3 a 90 s)</option><option value="video">Vídeo na Página</option></select></label>
    <div class="fb-titulo" hidden>${campoTexto('titulo', 'Título do vídeo', { linhas: 1, limite: 255, gerar: 'yt-titulo' })}</div>
    ${campoTexto('legenda', 'Legenda', { linhas: 6, gerar: 'completo' })}`,
  x: () => `
    ${campoTexto('texto', 'Texto do post', { linhas: 3, limite: 280, gerar: 'x-texto', dica: 'o vídeo vai anexado; links contam 23 caracteres' })}
    <p class="dica">O X cobra por uso da API: sem crédito na conta o post falha com "402".</p>`,
};

// Valor gerado a partir do texto base, por tipo de campo.
function gerarCampo(tipo) {
  const tags = hashtags();
  const titulo = $('#titulo').value.trim();
  if (tipo === 'yt-titulo') return titulo.slice(0, 100);
  if (tipo === 'yt-descricao') {
    const partes = [$('#legenda').value.trim(), $('#chamada').value.trim().replace(/@willscaff/g, 'o canal'), $('#assinatura').value.trim(), tags.join(' ')];
    return partes.filter(Boolean).join('\n\n');
  }
  if (tipo === 'yt-tags') return tags.map((h) => h.slice(1)).join(', ');
  if (tipo === 'x-texto') return caber(titulo, tags, 280);
  return textoPadrao();
}

// Atualiza os campos que ainda seguem o texto base e todos os contadores.
function sincronizarCampos() {
  $$('#opcoesDestinos [data-gerar]').forEach((el) => {
    if (el.dataset.editado !== '1') el.value = gerarCampo(el.dataset.gerar);
    const rotulo = el.closest('.campo-rede');
    $('[data-voltar-base]', rotulo).hidden = el.dataset.editado !== '1';
    const lim = Number(el.dataset.limite || 0);
    let txt = lim ? el.value.length + '/' + lim : el.value.length + ' caracteres';
    const ht = (el.value.match(/#[\p{L}\p{N}_]+/gu) || []).length;
    if (el.dataset.op === 'legenda' && rotulo.closest('[data-plat="instagram"]')) txt += ' · ' + ht + '/30 hashtags';
    const cont = $('.contador', rotulo);
    cont.textContent = txt;
    cont.classList.toggle('passou', (lim && el.value.length > lim) || (ht > 30 && !!rotulo.closest('[data-plat="instagram"]')));
  });
}

// ---------- montagem do texto: título + extra + assinatura + hashtags ----------

// "KKKKK ASSIM QUE TRATAMOS" -> "KKKKK assim que tratamos" (título da Twitch vem gritado).
function tituloBonito(nome) {
  const t = String(nome || '').trim();
  const letras = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (!letras || letras !== letras.toUpperCase()) return t;
  const baixo = t.split(/(\s+)/).map((p) => (/^(K|HA|HUE|RS)+[!?.]*$/i.test(p) ? p : p.toLocaleLowerCase('pt-BR'))).join('');
  return baixo.charAt(0).toLocaleUpperCase('pt-BR') + baixo.slice(1);
}

// Ganchos: a primeira linha é o que faz a pessoa parar de rolar o feed.
// Escolhidos pelo "clima" do título do clipe; {t} é o título do clipe arrumado.
const GANCHOS = {
  risada: [
    'Eu não aguentei essa 😂 {t}',
    '{t} 😂 (espera o final)',
    'Quem tava na live chorou de rir com essa 😂',
    'O RP mais sem noção que você vai ver hoje 😂',
    'Não era pra ter terminado assim 💀😂',
    'Isso é GTA RP ou novela? 😂',
  ],
  treta: [
    'Mexeu com a pessoa errada 😤 {t}',
    'Ninguém esperava essa reação 😳',
    'A treta que parou a cidade 🚨',
    'Olha como terminou essa discussão 👀',
    'Foi longe demais... 😬 {t}',
    'Respeito se conquista assim 😤',
  ],
  acao: [
    'A fuga mais insana da Capital 🚔💨',
    'Deu tudo errado no pior momento 😱',
    'Segura o coração até o final 😱 {t}',
    'Plano perfeito... até não ser 💀',
    'Isso foi sorte ou habilidade? 🤯',
    'Ninguém sai vivo dessa... ou sai? 👀',
  ],
  geral: [
    'Espera até o final 👀 {t}',
    'Mais um dia normal na Capital 🏙️😂',
    'Você não vai acreditar no que aconteceu na live 👀',
    'O final me quebrou 😭',
    'Isso aconteceu AO VIVO 🔴 {t}',
    'Comenta se você faria o mesmo 👇 {t}',
  ],
};

function climaDoTitulo(t) {
  const s = t.toLowerCase();
  if (/k{3,}|haha|rs{2,}|kkk|zoei|zoeira|engra|sem querer|meme/.test(s)) return 'risada';
  if (/mal educad|treta|briga|xing|raiva|respeit|discuss|humilh|tratamos|brav/.test(s)) return 'treta';
  if (/fuga|poli|pm|tiro|sequestr|assalt|corrida|morr|matou|persegui|bala|roub/.test(s)) return 'acao';
  return 'geral';
}

let rodadaGanchos = 0;
function sugerirGanchos(nome) {
  const t = tituloBonito(nome).replace(/[.!]+$/, '');
  const clima = climaDoTitulo(t);
  // mistura o clima principal com um pouco de "geral", e gira a cada clique em "outras ideias"
  const base = [...GANCHOS[clima], ...GANCHOS.geral.filter(() => clima !== 'geral')];
  const n = base.length;
  const lista = [];
  for (let i = 0; i < 5; i++) lista.push(base[(i + rodadaGanchos * 5) % n].replace('{t}', t).trim());
  return [...new Set(lista)].map((g) => g.slice(0, 100));
}

function desenharGanchos() {
  const c = estado.clipes.find((x) => x.id === estado.clipeId);
  if (!c) return;
  $('#ganchos').innerHTML = sugerirGanchos(c.nome).map((g) => `<button type="button" data-gancho="${esc(g)}">${esc(g)}</button>`).join('');
}

$('#ganchos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-gancho]');
  if (!b) return;
  $('#titulo').value = b.dataset.gancho;
  // se o gancho não cita o título original do clipe, ele vira o contexto
  const c = estado.clipes.find((x) => x.id === estado.clipeId);
  const original = c ? tituloBonito(c.nome).replace(/[.!]+$/, '') : '';
  if (original && !b.dataset.gancho.includes(original) && !$('#legenda').value.trim()) $('#legenda').value = original;
  if (original && b.dataset.gancho.includes(original) && $('#legenda').value.trim() === original) $('#legenda').value = '';
  atualizarPrevia();
});
$('#maisGanchos').addEventListener('click', () => { rodadaGanchos++; desenharGanchos(); });

function hashtags() {
  const vistas = new Set();
  return $('#hashtags').value.split(/[\s,;]+/).map((h) => h.replace(/^#+/, '').trim()).filter(Boolean)
    .map((h) => '#' + h).filter((h) => { const k = h.toLowerCase(); if (vistas.has(k)) return false; vistas.add(k); return true; });
}

// Coloca hashtags até caber no limite (X tem 280).
function caber(inicio, tags, limite) {
  let t = inicio.slice(0, limite);
  for (const h of tags) { if ((t + ' ' + h).length <= limite) t += (t ? ' ' : '') + h; }
  return t;
}

function textoPadrao() {
  const partes = [$('#titulo').value.trim(), $('#legenda').value.trim(), $('#chamada').value.trim(), $('#assinatura').value.trim(), hashtags().join(' ')];
  return partes.filter(Boolean).join('\n\n');
}

function atualizarPrevia() {
  $('#previaTexto').textContent = textoPadrao() || '(vazio)';
  sincronizarCampos();
}

async function carregarPrefs() {
  const p = await api('GET', '/api/preferencias');
  if (!$('#assinatura').value) $('#assinatura').value = p.assinatura || '';
  if (!$('#chamada').value) $('#chamada').value = p.chamada || '';
  if (!$('#hashtags').value) $('#hashtags').value = p.hashtags || '';
}

['#titulo', '#legenda', '#chamada', '#assinatura', '#hashtags'].forEach((s) => $(s).addEventListener('input', atualizarPrevia));

let buscandoCriador = false;
async function carregarCriadorTikTok() {
  if (buscandoCriador) return;
  buscandoCriador = true;
  try { estado.tiktokCriador = await api('GET', '/api/tiktok/criador'); }
  catch (e) { estado.tiktokCriador = { erro: 'Não consegui ler sua conta do TikTok: ' + e.message }; }
  buscandoCriador = false;
  desenharOpcoes();
}

// Mostra só o que vale pro modo escolhido e monta o aviso legal que o TikTok exige.
function ajustarTikTok() {
  const bloco = $('.opcoes-destino[data-plat="tiktok"]');
  if (!bloco || !$('[data-op="modo"]', bloco)) return;
  const direto = $('[data-op="modo"]', bloco).value === 'direto';
  $('.tt-direto', bloco).hidden = !direto;
  const comercial = $('[data-op="comercial"]', bloco).checked;
  $('.tt-comercial', bloco).hidden = !comercial;
  if (!comercial) { $('[data-op="marcaPropria"]', bloco).checked = false; $('[data-op="conteudoMarca"]', bloco).checked = false; }
  const marca = $('[data-op="conteudoMarca"]', bloco).checked;
  const soEu = $('option[value="SELF_ONLY"]', bloco);
  if (soEu) { soEu.disabled = marca; if (marca && soEu.selected) $('[data-op="privacidade"]', bloco).value = ''; }
  $('.tt-consentimento', bloco).innerHTML = 'Ao postar, você concorda com a <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener">Confirmação de Uso de Música</a> do TikTok' +
    (marca ? ' e com a <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noopener">Política de Conteúdo de Marca</a>' : '') + '.';
}

function escolherClipe(id) {
  const trocou = estado.clipeId !== id;
  estado.clipeId = id;
  estado.avisos = {};
  const c = estado.clipes.find((x) => x.id === id);
  if (c && (trocou || !$('#titulo').value)) {
    rodadaGanchos = 0;
    const [melhor] = sugerirGanchos(c.nome);
    const original = tituloBonito(c.nome).replace(/[.!]+$/, '');
    $('#titulo').value = melhor;
    $('#legenda').value = melhor.includes(original) ? '' : original;
  }
  desenharGanchos();
  atualizarPrevia();
  if (trocou) carregarCapa();
  api('GET', '/api/clipes/' + id + '/avisos').then((a) => { estado.avisos = a; desenharAvisos(); }).catch(() => {});
}

function desenharPostar() {
  const c = estado.clipes.find((x) => x.id === estado.clipeId && x.estado === 'pronto');
  const chegando = estado.aguardando && estado.clipes.find((x) => x.id === estado.aguardando);
  $('#esperandoClipe').hidden = !chegando;
  if (chegando) {
    $('#esperandoClipe').innerHTML = `<p><i class="giro"></i>${esc(chegando.nome)}: ${esc(chegando.etapa || 'preparando')}${chegando.progresso ? ' — ' + chegando.progresso + '%' : ''}</p>
      <div class="barra" style="max-width:360px;margin:0 auto"><i style="width:${chegando.progresso || 3}%"></i></div>
      <p class="dica">Quando terminar, o formulário de postagem abre aqui sozinho.</p>`;
  }
  $('#semClipe').hidden = !!c || !!chegando;
  $('#formPostar').hidden = !c || !!chegando;
  if (!c) return;
  const v = $('#videoPostar');
  const src = '/midia/' + c.id + '/video';
  if (!v.src.endsWith(src)) v.src = src;
  const i = c.info;
  $('#infoPostar').textContent = `${c.nome} · ${tempo(i.duracao)} · ${i.largura}×${i.altura} · ${mb(i.tamanho)}`;

  const destinos = estado.plataformas.filter((p) => p.tipo === 'destino');
  const marcados = new Set(estado.preMarcar || $$('#destinos input:checked').map((x) => x.value));
  estado.preMarcar = null;
  const feitas = redesPostadas(c.id);
  $('#destinos').innerHTML = destinos.map((p) => {
    const pronto = p.conectado;
    let sub = !pronto ? 'configure em Contas' : p.teste && !p.teste.ok ? 'último teste falhou' : p.teste ? esc(p.teste.conta).slice(0, 40) : 'não testado';
    if (feitas.has(p.id)) sub = '✓ já postado com esse clipe';
    return `<label class="destino ${pronto ? '' : 'desligado'} ${marcados.has(p.id) ? 'marcado' : ''}">
      <input type="checkbox" value="${p.id}" ${pronto ? '' : 'disabled'} ${marcados.has(p.id) ? 'checked' : ''}>
      <span>${esc(p.nome)}<small>${sub}</small></span></label>`;
  }).join('');
  desenharOpcoes();
}

function desenharOpcoes() {
  const alvo = $('#opcoesDestinos');
  const marcados = $$('#destinos input:checked').map((x) => x.value);
  $$('#destinos .destino').forEach((l) => l.classList.toggle('marcado', $('input', l).checked));
  // preserva o que ja foi digitado/escolhido (inclusive quais textos foram editados à mão)
  const antes = {};
  $$('.opcoes-destino', alvo).forEach((bloco) => {
    antes[bloco.dataset.plat] = $$('[data-op]', bloco).map((el) => ({
      op: el.dataset.op, tipo: el.type, valor: el.value, marcado: el.checked, editado: el.dataset.editado,
    }));
  });
  alvo.innerHTML = marcados.map((id) => {
    const p = estado.plataformas.find((x) => x.id === id);
    const conta = p.teste && p.teste.ok ? esc(String(p.teste.conta).split(' — ')[0].split(' (')[0]) : '';
    return `<div class="opcoes-destino" data-plat="${id}">
      <h3>${esc(p.nome)}${conta ? ` <small class="dica">· ${conta}</small>` : ''}</h3>
      ${opcoesPorPlat[id](p)}<div class="avisos"></div></div>`;
  }).join('');
  for (const [plat, campos] of Object.entries(antes)) {
    const bloco = $(`.opcoes-destino[data-plat="${plat}"]`, alvo);
    if (!bloco) continue;
    for (const c of campos) {
      const el = c.tipo === 'radio'
        ? $(`[data-op="${c.op}"][value="${c.valor}"]`, bloco)
        : $(`[data-op="${c.op}"]`, bloco);
      if (!el) continue;
      if (c.tipo === 'radio') { if (c.marcado) el.checked = true; }
      else if (el.type === 'checkbox') el.checked = c.marcado;
      else { el.value = c.valor; if (c.editado) el.dataset.editado = c.editado; }
    }
  }
  $('#botaoPostar').disabled = !marcados.length;
  $('#resumoPostar').textContent = marcados.length ? 'Vai para: ' + marcados.map((m) => NOMES_PLAT[m]).join(', ') : 'Marque onde postar.';
  ajustarTikTok();
  ajustarPaineis();
  desenharAvisos();
  sincronizarCampos();
}

// Mostra/esconde o que depende de outra escolha no mesmo painel.
function ajustarPaineis() {
  const fb = $('.opcoes-destino[data-plat="facebook"]');
  if (fb) $('.fb-titulo', fb).hidden = $('[data-op="modo"]', fb).value !== 'video';
  const yt = $('.opcoes-destino[data-plat="youtube"]');
  if (yt) {
    const criancas = $('[data-op="paraCriancas"][value="sim"]', yt).checked;
    const idade = $('[data-op="restricaoIdade"]', yt);
    idade.disabled = criancas;
    if (criancas) idade.checked = false;
  }
}

function desenharAvisos() {
  $$('.opcoes-destino').forEach((bloco) => {
    const plat = bloco.dataset.plat;
    let lista = estado.avisos[plat] || [];
    if (plat === 'facebook' && $('[data-op="modo"]', bloco).value === 'video') lista = lista.filter((a) => !/Reel/.test(a));
    $('.avisos', bloco).innerHTML = lista.map((a) => `<div class="aviso-plat">⚠ ${esc(a)}</div>`).join('');
  });
}

$('#destinos').addEventListener('change', desenharOpcoes);
// digitou num campo de uma rede: ele passa a ser "seu" e para de seguir o texto base
$('#opcoesDestinos').addEventListener('input', (e) => {
  if (e.target.dataset && e.target.dataset.gerar) e.target.dataset.editado = '1';
  sincronizarCampos();
});
$('#opcoesDestinos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-voltar-base]');
  if (!b) return;
  e.preventDefault();
  const el = $('[data-gerar]', b.closest('.campo-rede'));
  delete el.dataset.editado;
  sincronizarCampos();
});
$('#opcoesDestinos').addEventListener('change', () => { ajustarTikTok(); ajustarPaineis(); desenharAvisos(); });
['#titulo', '#legenda', '#chamada', '#assinatura', '#hashtags'].forEach((s) => $(s).addEventListener('input', sincronizarCampos));
$('#trocarClipe').addEventListener('click', () => irPara('clipes'));

function coletar(bloco) {
  const op = {};
  $$('[data-op]', bloco).forEach((el) => {
    if (el.type === 'radio') { if (el.checked) op[el.dataset.op] = el.value; }
    else op[el.dataset.op] = el.type === 'checkbox' ? el.checked : el.value.trim();
  });
  return op;
}

// Monta o que vai pra cada rede e barra o que a rede recusaria. Devolve {destinos} ou {erro}.
function montarDestinos() {
  const destinos = {};
  for (const bloco of $$('.opcoes-destino')) {
    const op = coletar(bloco);
    const plat = bloco.dataset.plat;
    const nome = NOMES_PLAT[plat];
    if (plat === 'youtube') {
      if (!op.titulo) return { erro: 'YouTube: o título não pode ficar vazio.' };
      if (op.titulo.length > 100) return { erro: 'YouTube: o título passa de 100 caracteres.' };
      if (op.descricao.length > 5000) return { erro: 'YouTube: a descrição passa de 5000 caracteres.' };
      let publicarEm = null;
      if (op.publicarEm) {
        const d = new Date(op.publicarEm);
        if (!(d > new Date(Date.now() + 5 * 60000))) return { erro: 'YouTube: o agendamento precisa ser pelo menos 5 minutos no futuro.' };
        publicarEm = d.toISOString();
      }
      destinos.youtube = {
        titulo: op.titulo, descricao: op.descricao, tags: op.tags.split(',').map((t) => t.trim()).filter(Boolean),
        privacidade: op.privacidade, publicarEm, categoria: op.categoria, paraCriancas: op.paraCriancas === 'sim',
        restricaoIdade: op.restricaoIdade, shorts: op.shorts, notificar: op.notificar,
      };
    }
    if (plat === 'instagram') {
      if (op.legenda.length > 2200) return { erro: 'Instagram: a legenda passa de 2200 caracteres.' };
      if ((op.legenda.match(/#[\p{L}\p{N}_]+/gu) || []).length > 30) return { erro: 'Instagram: mais de 30 hashtags, o Instagram recusa.' };
      destinos.instagram = { legenda: op.legenda, feed: op.feed };
    }
    if (plat === 'tiktok') {
      if (op.legenda.length > 2200) return { erro: 'TikTok: a legenda passa de 2200 caracteres.' };
      if (op.modo === 'direto') {
        if (!op.privacidade) return { erro: 'TikTok: escolha "Quem pode ver este vídeo".' };
        if (op.comercial && !op.marcaPropria && !op.conteudoMarca) return { erro: 'TikTok: marque "Sua marca" ou "Conteúdo de marca", ou desligue a divulgação comercial.' };
      }
      destinos.tiktok = {
        legenda: op.legenda, modo: op.modo, privacidade: op.privacidade, permitirComentario: op.permitirComentario, permitirDueto: op.permitirDueto,
        permitirCostura: op.permitirCostura, marcaPropria: op.marcaPropria, conteudoMarca: op.conteudoMarca,
      };
    }
    if (plat === 'facebook') {
      if (op.modo === 'video' && !op.titulo) return { erro: 'Facebook: dê um título pro vídeo.' };
      destinos.facebook = { legenda: op.legenda, modo: op.modo, titulo: op.modo === 'video' ? op.titulo : '' };
    }
    if (plat === 'x') {
      if (!op.texto) return { erro: 'X: o texto do post não pode ficar vazio.' };
      if (op.texto.length > 280) return { erro: 'X: o texto passa de 280 caracteres.' };
      destinos.x = { texto: op.texto };
    }
    if (!destinos[plat]) return { erro: nome + ': painel incompleto.' };
  }
  return { destinos };
}

// Tela de conferência: rede por rede, exatamente o que vai sair.
function resumoConferencia(destinos) {
  const conta = (plat) => { const p = estado.plataformas.find((x) => x.id === plat); return p && p.teste && p.teste.ok ? String(p.teste.conta).split(' — ')[0].split(' (')[0] : ''; };
  const linha = (rotulo, valor) => valor ? `<div class="conf-linha"><span>${rotulo}</span><b>${valor}</b></div>` : '';
  const texto = (t) => `<pre class="conf-texto">${esc(t)}</pre>`;
  const vis = { public: 'Público', unlisted: 'Não listado', private: 'Privado' };
  const priv = { PUBLIC_TO_EVERYONE: 'Todo mundo', FOLLOWER_OF_CREATOR: 'Seguidores', MUTUAL_FOLLOW_FRIENDS: 'Amigos', SELF_ONLY: 'Somente eu' };
  const partes = [];
  const y = destinos.youtube;
  if (y) partes.push(`<section><h3>YouTube <small>${esc(conta('youtube'))}</small></h3>
    ${linha('Formato', ehShort() ? 'Short' : 'Vídeo normal')}
    ${linha('Visibilidade', y.publicarEm ? 'Agendado para ' + new Date(y.publicarEm).toLocaleString('pt-BR') : vis[y.privacidade])}
    ${linha('Público', y.paraCriancas ? 'Feito para crianças' : 'Não é para crianças')}
    ${linha('Restrição de idade', y.restricaoIdade ? '18+' : 'Nenhuma')}
    ${linha('Avisar inscritos', y.notificar ? 'Sim' : 'Não')}${linha('Capa', capaImagem() + (estado.capa && ehShort() ? ' (em Short o feed pode mostrar um quadro do vídeo)' : ''))}
    ${linha('Tags', esc(y.tags.join(', ')))}
    <div class="conf-rotulo">Título</div>${texto(y.titulo)}<div class="conf-rotulo">Descrição</div>${texto(y.descricao + (y.shorts && ehShort() && !/#shorts/i.test(y.descricao) ? '\n\n#Shorts' : ''))}</section>`);
  const i = destinos.instagram;
  if (i) partes.push(`<section><h3>Instagram <small>${esc(conta('instagram'))}</small></h3>
    ${linha('Formato', 'Reel' + (i.feed ? ' + feed' : ' só na aba Reels'))}${linha('Capa', capaQuadro())}
    <div class="conf-rotulo">Legenda</div>${texto(i.legenda)}</section>`);
  const f = destinos.facebook;
  if (f) partes.push(`<section><h3>Facebook <small>${esc(conta('facebook'))}</small></h3>
    ${linha('Formato', f.modo === 'video' ? 'Vídeo na Página' : 'Reel')}${linha('Capa', capaImagem())}${f.titulo ? '<div class="conf-rotulo">Título</div>' + texto(f.titulo) : ''}
    <div class="conf-rotulo">Legenda</div>${texto(f.legenda)}</section>`);
  const t = destinos.tiktok;
  if (t) partes.push(`<section><h3>TikTok <small>${esc(conta('tiktok'))}</small></h3>
    ${linha('Envio', t.modo === 'direto' ? 'Publicar direto' : 'Vai pro app; você publica pelo celular')}${linha('Capa', capaQuadro())}
    ${t.modo === 'direto' ? linha('Quem pode ver', priv[t.privacidade]) + linha('Permitir', [t.permitirComentario && 'comentários', t.permitirDueto && 'dueto', t.permitirCostura && 'costura'].filter(Boolean).join(', ') || 'nada') + linha('Comercial', t.conteudoMarca ? 'Parceria paga' : t.marcaPropria ? 'Sua marca' : 'Não') : ''}
    <div class="conf-rotulo">Legenda</div>${texto(t.legenda)}</section>`);
  const x = destinos.x;
  if (x) partes.push(`<section><h3>X <small>${esc(conta('x'))}</small></h3><div class="conf-rotulo">Texto (${x.texto.length}/280)</div>${texto(x.texto)}</section>`);
  const c = clipeAtual();
  const img = estado.capa ? `<img class="conf-capa" src="/midia/${c.id}/capa?v=${estado.capa.em}" alt="Capa">` : '';
  return `<p class="dica">Clipe: <b>${esc(c ? c.nome : '')}</b>${c && c.info ? ' · ' + tempo(c.info.duracao) + ' · ' + c.info.largura + '×' + c.info.altura : ''}</p>` + img + partes.join('');
}

let destinosConferidos = null;
$('#botaoPostar').addEventListener('click', () => {
  const r = montarDestinos();
  if (r.erro) return toast(r.erro, true);
  destinosConferidos = r.destinos;
  $('#conferirConteudo').innerHTML = resumoConferencia(r.destinos);
  $('#dlgConferir').showModal();
});

$('#dlgConferir').addEventListener('close', async () => {
  if ($('#dlgConferir').returnValue !== 'publicar' || !destinosConferidos) return;
  const destinos = destinosConferidos;
  destinosConferidos = null;
  if ($('#salvarPadrao').checked) {
    api('POST', '/api/preferencias', { chamada: $('#chamada').value.trim(), assinatura: $('#assinatura').value.trim(), hashtags: hashtags().join(' ') }).catch(() => {});
  }
  const b = $('#botaoPostar');
  b.disabled = true;
  try {
    await api('POST', '/api/postagens', {
      clipeId: estado.clipeId, destinos,
      capa: estado.capa ? { segundos: estado.capa.segundos, imagem: true } : null,
    });
    toast('Enviando! Acompanhe no Histórico.');
    $$('#destinos input:checked').forEach((x) => { x.checked = false; });
    desenharOpcoes();
    await carregarPostagens();
    irPara('historico');
  } catch (e) { toast(e.message, true); }
  b.disabled = false;
});

// ---------- capa ----------
// Uma imagem por clipe. YouTube e Facebook recebem a imagem (com texto);
// Instagram e TikTok só aceitam o quadro do vídeo, então vai o segundo escolhido.

const capaQuadro = () => estado.capa ? 'quadro em ' + tempo(estado.capa.segundos) + (estado.capa.texto || estado.capa.enviada ? ' (sem o texto/imagem, a rede só aceita quadro)' : '') : 'a rede escolhe';
const capaImagem = () => !estado.capa ? 'a rede escolhe' : estado.capa.enviada ? 'imagem enviada do PC' : estado.capa.texto ? 'quadro em ' + tempo(estado.capa.segundos) + ' com texto' : 'quadro em ' + tempo(estado.capa.segundos);

function desenharCapa() {
  const c = clipeAtual();
  const cp = estado.capa;
  $('.capa-img').classList.toggle('deitada', !!(c && c.info && c.info.largura > c.info.altura));
  $('#capaImg').hidden = !cp;
  $('#capaVazia').hidden = !!cp;
  if (cp && c) $('#capaImg').src = '/midia/' + c.id + '/capa?v=' + cp.em;
  $('#capaTirar').hidden = !cp;
  $('#capaInfo').textContent = cp ? 'Capa: ' + capaImagem() + '.' : '';
}

async function carregarCapa() {
  const id = estado.clipeId;
  estado.capa = null;
  desenharCapa();
  if (!id) return;
  const cp = await api('GET', '/api/clipes/' + id + '/capa').catch(() => ({}));
  if (estado.clipeId !== id) return;
  estado.capa = cp && cp.em ? cp : null;
  if (estado.capa) {
    $('#capaTexto').value = cp.texto || '';
    if (cp.cor) $('#capaCor').value = cp.cor;
    if (cp.posicao) $('#capaPosicao').value = cp.posicao;
  } else $('#capaTexto').value = '';
  desenharCapa();
}

async function gerarCapa(segundos) {
  const id = estado.clipeId;
  if (!id) return;
  const botoes = ['#capaQuadro', '#capaGerar'].map((s) => $(s));
  botoes.forEach((b) => { b.disabled = true; });
  $('#capaInfo').textContent = 'Gerando a capa…';
  try {
    const cp = await api('POST', '/api/clipes/' + id + '/capa', {
      segundos, texto: $('#capaTexto').value.trim(), cor: $('#capaCor').value, posicao: $('#capaPosicao').value,
    });
    if (estado.clipeId === id) estado.capa = cp;
  } catch (e) { toast('Capa: ' + e.message, true); }
  botoes.forEach((b) => { b.disabled = false; });
  desenharCapa();
}

const segundoAtual = () => Math.round(($('#videoPostar').currentTime || 0) * 10) / 10;
$('#capaQuadro').addEventListener('click', () => gerarCapa(segundoAtual()));
// "Gerar" mantém o quadro já escolhido; sem capa ainda, usa onde o vídeo está parado
$('#capaGerar').addEventListener('click', () => gerarCapa(estado.capa && !estado.capa.enviada ? estado.capa.segundos : segundoAtual()));
$('#capaUsarGancho').addEventListener('click', () => {
  $('#capaTexto').value = $('#titulo').value.replace(/[\p{Extended_Pictographic}️]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);
});
$('#capaTirar').addEventListener('click', async () => {
  const id = estado.clipeId;
  await api('DELETE', '/api/clipes/' + id + '/capa').catch((e) => toast(e.message, true));
  if (estado.clipeId === id) { estado.capa = null; $('#capaTexto').value = ''; }
  desenharCapa();
});
$('#capaArquivo').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  const id = estado.clipeId;
  if (!f || !id) return;
  if (f.size > 15 * 1048576) return toast('Imagem muito grande (máx. 15 MB).', true);
  $('#capaInfo').textContent = 'Enviando a imagem…';
  const x = new XMLHttpRequest();
  x.open('PUT', '/api/clipes/' + id + '/capa-imagem?nome=' + encodeURIComponent(f.name));
  x.setRequestHeader('X-Postador', '1');
  x.onload = () => {
    let j = {};
    try { j = JSON.parse(x.responseText); } catch (err) { /* */ }
    if (x.status >= 400) toast('Capa: ' + (j.erro || 'erro ' + x.status), true);
    else if (estado.clipeId === id) estado.capa = j;
    desenharCapa();
  };
  x.onerror = () => { toast('Falha ao enviar a imagem.', true); desenharCapa(); };
  x.send(f);
});

// ---------- histórico ----------

async function carregarPostagens() {
  estado.postagens = await api('GET', '/api/postagens');
  desenharHistorico();
  desenharBiblioteca();
  const ativos = estado.postagens.reduce((n, p) => n + Object.values(p.destinos).filter((d) => d.estado === 'enviando' || d.estado === 'na fila').length, 0);
  $('#contagemEnvios').textContent = ativos ? ativos + ' enviando' : '';
  clearTimeout(carregarPostagens.timer);
  if (ativos) carregarPostagens.timer = setTimeout(carregarPostagens, 2000);
}

function desenharHistorico() {
  const alvo = $('#historico');
  if (!estado.postagens.length) { alvo.innerHTML = '<div class="vazio">Nada postado ainda.</div>'; return; }
  alvo.innerHTML = estado.postagens.map((p) => `<article class="postagem" data-id="${p.id}" data-clipe="${p.clipeId}">
    <header><b>${esc(p.clipeNome)}</b><span class="quando">${quando(p.criadoEm)}
      <button class="mini" data-outras>Postar nas outras redes</button>
      ${Object.values(p.destinos).some((d) => d.estado === 'ok') ? '<button class="mini perigo" data-apagar-todas>Apagar de todas as redes</button>' : ''}
      <button class="mini sec" data-apagar title="Só some desta lista; o post continua nas redes">Tirar do histórico</button></span></header>
    <div class="resultados">${Object.entries(p.destinos).map(([plat, d]) => {
      let status; let msg;
      if (d.estado === 'ok') { status = '<span class="status ok">publicado</span>'; msg = (d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.url)}</a>` : 'Enviado') + (d.aviso ? `<span class="aviso">⚠ ${esc(d.aviso)}</span>` : ''); }
      else if (d.estado === 'apagado') { status = '<span class="status">apagado</span>'; msg = 'Apagado da rede ' + quando(d.apagadoEm); }
      else if (d.estado === 'erro') { status = '<span class="status erro">falhou</span>'; msg = `<span class="erro">${esc(d.mensagem)}</span>`; }
      else { status = '<span class="status pendente">' + (d.estado === 'na fila' ? 'na fila' : 'enviando') + '</span>'; msg = '<i class="giro"></i>' + esc(d.etapa || 'aguardando'); }
      return `<div class="resultado"><b>${NOMES_PLAT[plat] || plat}</b><div class="msg ${d.estado === 'erro' ? 'erro' : ''}">${status} ${msg}</div>
        <div>${d.estado === 'erro' ? `<button class="mini sec" data-repetir="${plat}">Tentar de novo</button>` : ''}
          ${d.estado === 'ok' ? `<button class="mini perigo" data-apagar-rede="${plat}">Apagar</button>` : ''}
          ${plat === 'tiktok' && d.estado === 'ok' && d.opcoes && d.opcoes.legenda ? `<button class="mini sec" data-copiar-legenda="${esc(d.opcoes.legenda)}">Copiar legenda</button>` : ''}</div></div>`;
    }).join('')}</div>
  </article>`).join('');
}

$('#historico').addEventListener('click', async (e) => {
  const art = e.target.closest('.postagem');
  if (!art) return;
  try {
    const copiar = e.target.closest('[data-copiar-legenda]');
    if (copiar) {
      await navigator.clipboard.writeText(copiar.dataset.copiarLegenda);
      toast('Legenda copiada. Cole no TikTok.');
    } else if (e.target.closest('[data-outras]')) {
      postarNasOutras(art.dataset.clipe, estado.postagens.find((p) => p.id === art.dataset.id));
    } else if (e.target.closest('[data-repetir]')) {
      await api('POST', '/api/postagens/' + art.dataset.id + '/repetir/' + e.target.closest('[data-repetir]').dataset.repetir);
      await carregarPostagens();
    } else if (e.target.closest('[data-apagar-rede]')) {
      const p = estado.postagens.find((x) => x.id === art.dataset.id);
      const plat = e.target.closest('[data-apagar-rede]').dataset.apagarRede;
      abrirApagar(postadosDe([p]).filter((a) => a.plat === plat), p.clipeNome);
    } else if (e.target.closest('[data-apagar-todas]')) {
      const p = estado.postagens.find((x) => x.id === art.dataset.id);
      abrirApagar(postadosDe([p]), p.clipeNome);
    } else if (e.target.closest('[data-apagar]')) {
      if (!confirm('Tirar do histórico? O post continua publicado nas redes.')) return;
      await api('DELETE', '/api/postagens/' + art.dataset.id);
      await carregarPostagens();
    }
  } catch (err) { toast(err.message, true); }
});

// ---------- apagar das redes ----------
// Apaga o post publicado na própria rede. TikTok não tem isso na API: vira link pro post.

function postadosDe(lista) {
  const r = [];
  for (const p of lista) for (const [plat, d] of Object.entries(p.destinos)) if (d.estado === 'ok') r.push({ postagem: p.id, plat, url: d.url, em: d.fim || p.criadoEm });
  return r;
}
const postadosDoClipe = (clipeId) => postadosDe((estado.postagens || []).filter((p) => p.clipeId === clipeId));

let alvosApagar = [];
function abrirApagar(alvos, nome) {
  alvosApagar = alvos;
  const pode = (plat) => { const p = estado.plataformas.find((x) => x.id === plat); return p && p.podeApagar; };
  $('#dlgApagar h2').textContent = 'Apagar das redes' + (nome ? ': ' + nome : '');
  $('#apagarResultado').innerHTML = '';
  $('#apagarLista').innerHTML = alvos.length ? alvos.map((a, i) => (pode(a.plat)
    ? `<label class="apagar-item"><input type="checkbox" data-i="${i}" checked><span><b>${NOMES_PLAT[a.plat]}</b>
        <small>${quando(a.em)}${a.url ? ` · <a href="${esc(a.url)}" target="_blank" rel="noopener">ver post</a>` : ''}</small>
        <span class="apagar-estado" data-estado="${i}"></span></span></label>`
    : `<div class="apagar-item desligado"><span><b>${NOMES_PLAT[a.plat]}</b>
        <small>não deixa apagar por aplicativo — apague no app${a.url ? `: <a href="${esc(a.url)}" target="_blank" rel="noopener">abrir o post</a>` : ' do celular'}</small></span></div>`)).join('')
    : '<p class="dica">Nada publicado pra apagar.</p>';
  $('#apagarConfirmar').hidden = false;
  $('#apagarConfirmar').disabled = !$$('#apagarLista input').length;
  $('#dlgApagar').showModal();
}
$('#apagarLista').addEventListener('change', () => { $('#apagarConfirmar').disabled = !$$('#apagarLista input:checked').length; });

$('#apagarConfirmar').addEventListener('click', async () => {
  const marcados = $$('#apagarLista input:checked').map((x) => Number(x.dataset.i));
  if (!marcados.length) return;
  const redes = marcados.map((i) => NOMES_PLAT[alvosApagar[i].plat]).join(', ');
  if (!confirm('Apagar de verdade em: ' + redes + '? Não dá pra desfazer.')) return;
  const b = $('#apagarConfirmar');
  b.disabled = true;
  $$('#apagarLista input').forEach((x) => { x.disabled = true; });
  let falhas = 0;
  for (const i of marcados) {
    const a = alvosApagar[i];
    const st = $(`[data-estado="${i}"]`);
    st.innerHTML = '<i class="giro"></i>apagando…';
    try {
      await api('DELETE', '/api/postagens/' + a.postagem + '/rede/' + a.plat);
      st.innerHTML = '<span class="status ok">apagado</span>';
    } catch (e) {
      falhas++;
      st.innerHTML = `<span class="status erro">falhou</span> <span class="apagar-erro">${esc(e.message)}</span>`;
    }
  }
  b.hidden = true;
  $('#apagarResultado').innerHTML = `<p class="dica">${falhas ? falhas + ' não deu pra apagar (motivo acima).' : 'Pronto, apagado.'}</p>`;
  await carregarPostagens();
});

// ---------- início ----------

(async () => {
  try {
    await Promise.all([carregarEstado(), carregarClipes(), carregarPostagens(), carregarPrefs()]);
  } catch (e) { toast('Não consegui falar com o app: ' + e.message, true); }
  const aba = location.hash.replace('#', '');
  irPara(Object.keys(PAGINAS).includes(aba) ? aba : 'clipes');
})();
window.addEventListener('focus', () => { carregarEstado().catch(() => {}); });
window.addEventListener('hashchange', () => {
  const aba = location.hash.replace('#', '');
  if (Object.keys(PAGINAS).includes(aba)) irPara(aba);
});
