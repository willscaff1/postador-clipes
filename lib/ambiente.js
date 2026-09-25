// Onde o painel esta rodando: no seu PC (padrao) ou na nuvem (Railway).
// Na nuvem tudo vem das variaveis de ambiente:
//   PORT            porta que o Railway manda (automatico)
//   BASE_URL        endereco publico, ex.: https://postador.up.railway.app
//                   (se faltar, usa RAILWAY_PUBLIC_DOMAIN)
//   SENHA_PAINEL    senha pra entrar no painel (obrigatoria na nuvem)
//   DADOS_DIR       pasta do volume onde ficam contas, clipes e analises (ex.: /data)
const fs = require('fs');
const path = require('path');

const NUVEM = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.POSTADOR_NUVEM);
const PORTA = Number(process.env.PORT || process.env.PORTA) || 8790;
const BASE_URL = (process.env.BASE_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : ''))
  .replace(/\/+$/, '') || null;
const SENHA = process.env.SENHA_PAINEL || '';
const DADOS = process.env.DADOS_DIR || path.join(__dirname, '..', 'dados');
const WINDOWS = process.platform === 'win32';

// Endereco que o navegador usa pra voltar ao painel (login das redes, links).
function urlBase() { return BASE_URL || 'http://localhost:' + PORTA; }

// Retorno do login (OAuth) de cada rede. No PC, o Google exige 127.0.0.1.
function urlRetorno(plat, { loopbackIp } = {}) {
  if (BASE_URL) return BASE_URL + '/oauth/' + plat + '/callback';
  return 'http://' + (loopbackIp ? '127.0.0.1' : 'localhost') + ':' + PORTA + '/oauth/' + plat + '/callback';
}

// Hosts aceitos (protecao contra DNS rebinding no modo local).
function hostsPermitidos() {
  const h = new Set(['localhost:' + PORTA, '127.0.0.1:' + PORTA]);
  if (BASE_URL) h.add(new URL(BASE_URL).host);
  return h;
}

// Fontes: Windows no PC, pacotes livres (Liberation/DejaVu) no Linux da nuvem.
const FONTES = {
  grossa: ['C:/Windows/Fonts/ariblk.ttf', 'C:/Windows/Fonts/arialbd.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
  tag: ['C:/Windows/Fonts/seguibl.ttf', 'C:/Windows/Fonts/arialbd.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf'],
  simbolo: ['C:/Windows/Fonts/seguisym.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
};
function fonte(tipo) { return FONTES[tipo].find((f) => fs.existsSync(f)) || null; }
// o filtro do ffmpeg precisa de "C\:" no caminho de fonte do Windows
const fonteFiltro = (arquivo) => (arquivo ? arquivo.replace(/\\/g, '/').replace(/:/g, '\\:') : null);

// curl: o do Windows fica no System32; no Linux vem do sistema.
const CURL = WINDOWS ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'curl.exe') : 'curl';

module.exports = { NUVEM, PORTA, BASE_URL, SENHA, DADOS, WINDOWS, urlBase, urlRetorno, hostsPermitidos, fonte, fonteFiltro, CURL };
