// Baixa so o pedaco de uma live gravada (HLS) que o corte precisa.
//
// Em vez de deixar o ffmpeg ler a live direto da internet (cada versao do ffmpeg
// trata HLS de um jeito, e na nuvem isso falhava sem dizer o motivo), o painel
// pega a lista de pedacos (.ts), baixa so os que cobrem o trecho, com nova
// tentativa se a rede falhar, e junta num arquivo local. O ffmpeg trabalha
// com esse arquivo.
const fs = require('fs');

const NAVEGADOR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

async function pedirTexto(url) {
  let ultimo;
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': NAVEGADOR }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('a lista da live respondeu ' + r.status);
      return await r.text();
    } catch (e) { ultimo = e; await new Promise((ok) => setTimeout(ok, 1000 * (t + 1))); }
  }
  throw new Error('Nao consegui ler a lista de pedacos da live (' + ultimo.message + ').');
}

async function pedirBinario(url) {
  let ultimo;
  for (let t = 0; t < 5; t++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': NAVEGADOR }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error('respondeu ' + r.status);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { ultimo = e; await new Promise((ok) => setTimeout(ok, 1500 * (t + 1))); }
  }
  throw new Error('Nao consegui baixar um pedaco da live (' + ultimo.message + ').');
}

// Lista de pedacos com o tempo de inicio de cada um. Se vier a master, desce pra melhor qualidade.
async function pedacos(url) {
  let texto = await pedirTexto(url);
  if (/#EXT-X-STREAM-INF/.test(texto)) {
    const linhas = texto.split(/\r?\n/);
    let melhor = null;
    for (let i = 0; i < linhas.length; i++) {
      const m = /^#EXT-X-STREAM-INF:(.*)$/.exec(linhas[i]);
      if (!m || !/RESOLUTION=/.test(m[1])) continue;
      const banda = Number((/(?:^|,)BANDWIDTH=(\d+)/.exec(m[1]) || [])[1]) || 0;
      const alvo = linhas.slice(i + 1).find((l) => l && !l.startsWith('#'));
      if (alvo && (!melhor || banda > melhor.banda)) melhor = { banda, url: new URL(alvo, url).href };
    }
    if (!melhor) throw new Error('A live nao tem versao de video.');
    url = melhor.url;
    texto = await pedirTexto(url);
  }
  const lista = [];
  let t = 0; let dur = null; let init = null;
  for (const linha of texto.split(/\r?\n/)) {
    const mapa = /^#EXT-X-MAP:.*URI="([^"]+)"/.exec(linha);
    if (mapa) init = new URL(mapa[1], url).href;
    const inf = /^#EXTINF:([\d.]+)/.exec(linha);
    if (inf) { dur = Number(inf[1]); continue; }
    if (linha && !linha.startsWith('#') && dur != null) {
      lista.push({ url: new URL(linha, url).href, inicio: t, dur });
      t += dur; dur = null;
    }
  }
  if (!lista.length) throw new Error('A lista da live veio vazia.');
  return { lista, init, total: t };
}

// Baixa os pedacos que cobrem [inicio, fim] (+ folga) pra `destino`.
// Devolve o deslocamento: o segundo `inicio` da live vira `inicio - deslocamento` no arquivo.
async function baixarTrecho(url, inicio, fim, destino, aoProgresso) {
  const { lista, init, total } = await pedacos(url);
  const a = Math.max(0, inicio - 3); const b = Math.min(total, fim + 3);
  const escolhidos = lista.filter((p) => p.inicio + p.dur > a && p.inicio < b);
  if (!escolhidos.length) throw new Error('Esse trecho passa do fim da live (a live tem ' + Math.round(total / 60) + ' min).');
  const saida = fs.createWriteStream(destino);
  const escrever = (buf) => new Promise((ok, erro) => saida.write(buf, (e) => (e ? erro(e) : ok())));
  try {
    if (init) await escrever(await pedirBinario(init));
    // baixa 4 de cada vez, mas grava na ordem
    for (let i = 0; i < escolhidos.length; i += 4) {
      const lote = await Promise.all(escolhidos.slice(i, i + 4).map((p) => pedirBinario(p.url)));
      for (const buf of lote) await escrever(buf);
      if (aoProgresso) aoProgresso(Math.round(((i + lote.length) / escolhidos.length) * 100));
    }
  } finally {
    await new Promise((ok) => saida.end(ok));
  }
  return { deslocamento: escolhidos[0].inicio };
}

module.exports = { baixarTrecho, pedacos };
