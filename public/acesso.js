'use strict';
// Aba Acesso: sua senha, aparelhos conectados e (admin) usuários do painel.

let acessoDados = null;

function forcaSenha(s) {
  let p = 0;
  if (s.length >= 8) p++;
  if (s.length >= 12) p++;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) p++;
  if (/\d/.test(s)) p++;
  if (/[^A-Za-z0-9]/.test(s)) p++;
  return Math.min(4, p);
}
const CORES_FORCA = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#16a34a'];
const TEXTO_FORCA = ['muito fraca', 'fraca', 'razoável', 'boa', 'forte'];

async function carregarAcesso() {
  try { acessoDados = await api('GET', '/api/acesso'); } catch (e) { $('#acessoConteudo').innerHTML = `<div class="vazio erro">${esc(e.message)}</div>`; return; }
  desenharAcesso();
}

const iconeAparelho = (a) => (/Android|iPhone/.test(a) ? '📱' : '💻');
const quandoRel = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'agora';
  if (s < 3600) return 'há ' + Math.round(s / 60) + ' min';
  if (s < 86400) return 'há ' + Math.round(s / 3600) + ' h';
  return quando(iso);
};

function desenharAcesso() {
  const d = acessoDados;
  const admin = d.eu.papel === 'admin';
  $('#acessoConteudo').innerHTML = `
    <div class="acesso-grade">
      <section class="bloco-met">
        <h2>Sua conta</h2>
        <div class="item-acesso"><span class="avatar">${esc(d.eu.nome.charAt(0).toUpperCase())}</span>
          <div><b>${esc(d.eu.nome)}<span class="tag-papel">${admin ? 'Administrador' : 'Editor'}</span></b><small>usuário: ${esc(d.eu.usuario)}</small></div><span></span></div>
        <form class="form-acesso" id="formMinhaSenha">
          <h3>Trocar senha</h3>
          <label class="campo">Senha atual<input type="password" name="atual" autocomplete="current-password" required></label>
          <label class="campo">Nova senha<input type="password" name="nova" autocomplete="new-password" minlength="8" required data-forca="forcaMinha"></label>
          <div class="forca-senha"><i id="forcaMinha"></i></div>
          <label class="campo">Repita a nova senha<input type="password" name="repete" autocomplete="new-password" required></label>
          <button>Trocar senha</button>
          <p class="dica">Trocar a senha desconecta seus outros aparelhos.</p>
        </form>
      </section>

      <section class="bloco-met">
        <div class="cabecalho-secao"><h2>Aparelhos conectados</h2>
          <button class="sec mini" id="sairOutros">Sair de todos os outros</button></div>
        ${d.sessoes.map((s) => `
          <div class="item-acesso"><span class="icone-aparelho">${iconeAparelho(s.aparelho)}</span>
            <div><b>${esc(s.aparelho)}${s.id === d.sessaoAtual ? '<span class="tag-atual">este aparelho</span>' : ''}</b>
              <small>${admin ? esc(s.usuario) + ' · ' : ''}IP ${esc(s.ip || '?')} · usado ${quandoRel(s.ultimoUso)} · entrou ${quando(s.criadaEm)}</small></div>
            <div class="acoes-item">${s.id === d.sessaoAtual ? '<a class="mini-link" href="/sair">Sair</a>' : `<button class="mini perigo" data-encerrar="${s.id}">Desconectar</button>`}</div>
          </div>`).join('')}
      </section>

      ${admin ? `
      <section class="bloco-met">
        <h2>Usuários do painel</h2>
        ${d.usuarios.map((u) => `
          <div class="item-acesso"><span class="avatar">${esc(u.nome.charAt(0).toUpperCase())}</span>
            <div><b>${esc(u.nome)}<span class="tag-papel">${u.papel === 'admin' ? 'Administrador' : 'Editor'}</span></b>
              <small>${esc(u.usuario)} · ${u.ultimoAcesso ? 'último acesso ' + quandoRel(u.ultimoAcesso) : 'nunca entrou'}</small></div>
            <div class="acoes-item">${u.id === d.eu.id ? '<span class="dica">você</span>' : `
              <select data-papel="${u.id}" class="mini-select"><option value="editor" ${u.papel === 'editor' ? 'selected' : ''}>Editor</option><option value="admin" ${u.papel === 'admin' ? 'selected' : ''}>Admin</option></select>
              <button class="sec mini" data-redefinir="${u.id}">Nova senha</button>
              <button class="mini perigo" data-remover-usuario="${u.id}">Remover</button>`}</div>
          </div>`).join('')}
        <form class="form-acesso" id="formNovoUsuario">
          <h3>Novo usuário</h3>
          <div class="linha-2">
            <label class="campo">Nome<input name="nome" required></label>
            <label class="campo">Usuário<input name="usuario" required pattern="[A-Za-z0-9._-]{3,32}" placeholder="sem espaço"></label>
          </div>
          <label class="campo">Senha<input type="password" name="senha" minlength="8" required autocomplete="new-password" data-forca="forcaNovo"></label>
          <div class="forca-senha"><i id="forcaNovo"></i></div>
          <label class="campo">Papel
            <select name="papel"><option value="editor">Editor — corta, posta e vê métricas</option><option value="admin">Administrador — tudo, inclusive contas e usuários</option></select>
          </label>
          <button>Criar usuário</button>
        </form>
      </section>` : ''}

      <section class="bloco-met">
        <h2>Credenciais das redes</h2>
        <p class="dica">As chaves e tokens do YouTube, Instagram, TikTok, Facebook, X, Twitch e Kick ficam no cofre criptografado do painel e nunca aparecem na tela.
          ${admin ? 'Pra conectar, trocar ou remover, use a aba <b>Contas</b>.' : 'Só o administrador pode mexer nelas.'}</p>
        ${admin ? '<button class="sec" onclick="irPara(\'contas\')">Abrir Contas</button>' : ''}
      </section>
    </div>`;
}

$('#acessoConteudo').addEventListener('input', (e) => {
  const alvo = e.target.dataset.forca;
  if (!alvo) return;
  const f = forcaSenha(e.target.value);
  const barra = $('#' + alvo);
  barra.style.width = (e.target.value ? (f + 1) * 20 : 0) + '%';
  barra.style.background = CORES_FORCA[f];
  barra.title = TEXTO_FORCA[f];
});

$('#acessoConteudo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const b = $('button', e.target);
  b.disabled = true;
  try {
    if (e.target.id === 'formMinhaSenha') {
      if (f.nova !== f.repete) throw new Error('As duas senhas novas não batem.');
      await api('POST', '/api/acesso/minha-senha', { atual: f.atual, nova: f.nova });
      toast('Senha trocada. Os outros aparelhos foram desconectados.');
    } else if (e.target.id === 'formNovoUsuario') {
      await api('POST', '/api/acesso/usuarios', f);
      toast('Usuário criado.');
    }
    await carregarAcesso();
  } catch (err) { toast(err.message, true); b.disabled = false; }
});

$('#acessoConteudo').addEventListener('click', async (e) => {
  try {
    const enc = e.target.closest('[data-encerrar]');
    if (enc) { await api('DELETE', '/api/acesso/sessoes/' + enc.dataset.encerrar); toast('Aparelho desconectado.'); return carregarAcesso(); }
    if (e.target.closest('#sairOutros')) {
      if (!confirm('Desconectar todos os outros aparelhos da sua conta?')) return;
      await api('POST', '/api/acesso/sair-dos-outros');
      toast('Pronto, só este aparelho continua conectado.');
      return carregarAcesso();
    }
    const red = e.target.closest('[data-redefinir]');
    if (red) {
      const nova = prompt('Nova senha pra esse usuário (mínimo 8 caracteres):');
      if (!nova) return;
      await api('PATCH', '/api/acesso/usuarios/' + red.dataset.redefinir, { novaSenha: nova });
      toast('Senha redefinida. Os aparelhos dele foram desconectados.');
      return carregarAcesso();
    }
    const rem = e.target.closest('[data-remover-usuario]');
    if (rem) {
      const u = acessoDados.usuarios.find((x) => x.id === rem.dataset.removerUsuario);
      if (!confirm('Remover o usuário "' + u.usuario + '"? Ele perde o acesso na hora.')) return;
      await api('DELETE', '/api/acesso/usuarios/' + u.id);
      toast('Usuário removido.');
      return carregarAcesso();
    }
  } catch (err) { toast(err.message, true); }
});

$('#acessoConteudo').addEventListener('change', async (e) => {
  const p = e.target.closest('[data-papel]');
  if (!p) return;
  try { await api('PATCH', '/api/acesso/usuarios/' + p.dataset.papel, { papel: p.value }); toast('Papel atualizado.'); } catch (err) { toast(err.message, true); }
  carregarAcesso();
});

aoAbrirAba.acesso = carregarAcesso;
