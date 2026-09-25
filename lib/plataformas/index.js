const cofre = require('../cofre');

const lista = [
  require('./youtube'),
  require('./instagram'),
  require('./tiktok'),
  require('./facebook'),
  require('./x'),
  require('./twitch'),
  require('./kick'),
];
const porId = Object.fromEntries(lista.map((p) => [p.id, p]));

function obter(id) { return porId[id] || null; }

function mascarar(v) {
  const s = String(v);
  return s.length <= 8 ? '••••' : '••••' + s.slice(-4);
}

// O que a tela recebe: nunca o valor de um segredo, so se ele esta salvo.
function resumo(porta) {
  const status = cofre.lerStatus();
  return lista.map((p) => {
    const cred = cofre.obter(p.id);
    const faltando = p.campos.filter((c) => c.obrigatorio && !cred[c.nome]).map((c) => c.rotulo);
    const conectado = !p.oauth || p.campos.filter((c) => c.automatico).some((c) => cred[c.nome]);
    return {
      id: p.id, nome: p.nome, tipo: p.tipo, oauth: p.oauth, opcional: !!p.opcional,
      redirect: p.redirect ? p.redirect(porta) : null,
      passos: p.passos,
      campos: p.campos.map((c) => ({
        nome: c.nome, rotulo: c.rotulo, segredo: !!c.segredo, obrigatorio: !!c.obrigatorio, automatico: !!c.automatico, ajuda: c.ajuda,
        salvo: !!cred[c.nome],
        valor: c.segredo ? '' : (cred[c.nome] || ''),
        mascara: c.segredo && cred[c.nome] ? mascarar(cred[c.nome]) : '',
      })),
      configurado: faltando.length === 0 && Object.keys(cred).length > 0,
      conectado: faltando.length === 0 && conectado,
      faltando,
      teste: status[p.id] || null,
      privacidades: p.privacidades || null,
      podeApagar: typeof p.apagar === 'function',
    };
  });
}

module.exports = { lista, obter, resumo };
