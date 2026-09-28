// Detector de sirene de policia no audio (WAV mono 16 kHz, 16 bits).
//
// Sirene = um tom forte (bem acima do resto do espectro) entre ~450 e 1900 Hz
// que sobe e desce de forma continua por pelo menos ~1 s. Voz, motor e musica
// ate tem tom nessa faixa, mas pulam de nota ou duram pouco; a sirene "desliza".
// Saida: quanto de sirene tem em cada segundo (0 a 1).

const N = 2048; // ~128 ms
const PASSO = 1024; // ~64 ms
const TAXA = 16000;
const F_MIN = 450; const F_MAX = 1900;

function fft(re, im) {
  const n = re.length;
  for (let a = 1, j = 0; a < n; a++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (a < j) { let t = re[a]; re[a] = re[j]; re[j] = t; t = im[a]; im[a] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang); const wi = Math.sin(ang);
    for (let a = 0; a < n; a += len) {
      let cr = 1; let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const i2 = a + k + len / 2;
        const vr = re[i2] * cr - im[i2] * ci; const vi = re[i2] * ci + im[i2] * cr;
        re[i2] = re[a + k] - vr; im[i2] = im[a + k] - vi;
        re[a + k] += vr; im[a + k] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// Frequencia do tom mais forte de cada quadro e o quanto ele se destaca (dB).
function tonsPorQuadro(amostras) {
  const b0 = Math.floor((F_MIN * N) / TAXA); const b1 = Math.ceil((F_MAX * N) / TAXA);
  const janela = new Float64Array(N);
  for (let k = 0; k < N; k++) janela[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (N - 1));
  const re = new Float64Array(N); const im = new Float64Array(N);
  const nq = Math.max(0, Math.floor((amostras.length - N) / PASSO));
  const freq = new Float32Array(nq); const destaque = new Float32Array(nq); const nivel = new Float32Array(nq);
  const pot = new Float64Array(b1 - b0 + 1);
  for (let q = 0; q < nq; q++) {
    let e = 0;
    for (let k = 0; k < N; k++) { const v = amostras[q * PASSO + k]; re[k] = v * janela[k]; im[k] = 0; e += v * v; }
    nivel[q] = 10 * Math.log10(e / N + 1e-12);
    fft(re, im);
    let pico = 0; let bp = b0;
    for (let b = b0; b <= b1; b++) {
      const p = re[b] * re[b] + im[b] * im[b];
      pot[b - b0] = p;
      if (p > pico) { pico = p; bp = b; }
    }
    const ord = Array.from(pot).sort((x, y) => x - y);
    const mediana = ord[Math.floor(ord.length / 2)] + 1e-12;
    // interpolacao parabolica pra frequencia mais precisa
    const a = bp > b0 ? re[bp - 1] ** 2 + im[bp - 1] ** 2 : pico; const c = bp < b1 ? re[bp + 1] ** 2 + im[bp + 1] ** 2 : pico;
    const d = (a - c) / (2 * (a - 2 * pico + c) || 1);
    freq[q] = ((bp + (Number.isFinite(d) ? Math.max(-0.5, Math.min(0.5, d)) : 0)) * TAXA) / N;
    destaque[q] = 10 * Math.log10(pico / mediana);
  }
  return { freq, destaque, nivel, nq };
}

// Trechos em que o tom desliza continuamente (sweep) = sirene.
function sirenePorSegundo(amostras, opcoes = {}) {
  const { destaqueMin = 13, saltoMax = 90, duracaoMin = 1.0, varreduraMin = 180, nivelMin = -55 } = opcoes;
  const { freq, destaque, nivel, nq } = tonsPorQuadro(amostras);
  const quadrosPorSeg = TAXA / PASSO;
  const marca = new Uint8Array(nq);
  let ini = -1;
  const fechar = (fim) => {
    if (ini < 0) return;
    const n = fim - ini;
    if (n >= duracaoMin * quadrosPorSeg) {
      let fmin = Infinity; let fmax = -Infinity;
      for (let q = ini; q < fim; q++) { fmin = Math.min(fmin, freq[q]); fmax = Math.max(fmax, freq[q]); }
      if (fmax - fmin >= varreduraMin) for (let q = ini; q < fim; q++) marca[q] = 1;
    }
    ini = -1;
  };
  for (let q = 0; q < nq; q++) {
    const tom = destaque[q] >= destaqueMin && nivel[q] >= nivelMin;
    const continua = ini >= 0 && Math.abs(freq[q] - freq[q - 1]) <= saltoMax;
    if (tom && (ini < 0 || continua)) { if (ini < 0) ini = q; }
    else { fechar(q); if (tom) ini = q; }
  }
  fechar(nq);
  const segundos = Math.ceil(nq / quadrosPorSeg);
  const saida = new Float32Array(segundos);
  for (let q = 0; q < nq; q++) if (marca[q]) saida[Math.floor(q / quadrosPorSeg)] += 1 / quadrosPorSeg;
  return saida;
}

// Junta os segundos com sirene em trechos (perseguicoes).
function trechos(porSegundo, { janela = 20, densidade = 0.2, junta = 25, minimo = 12 } = {}) {
  const n = porSegundo.length;
  const soma = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) soma[i + 1] = soma[i] + porSegundo[i];
  const ativo = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - janela / 2); const b = Math.min(n, i + janela / 2);
    ativo.push((soma[b] - soma[a]) / (b - a) >= densidade);
  }
  const lista = [];
  for (let i = 0; i < n; i++) {
    if (!ativo[i]) continue;
    let f = i;
    while (f < n && ativo[f]) f++;
    const u = lista[lista.length - 1];
    if (u && i - u.fim <= junta) u.fim = f; else lista.push({ inicio: i, fim: f });
    i = f;
  }
  return lista.filter((t) => t.fim - t.inicio >= minimo).map((t) => ({
    ...t, sirene: Math.round((soma[t.fim] - soma[t.inicio]) * 10) / 10, forca: (soma[t.fim] - soma[t.inicio]) / (t.fim - t.inicio),
  }));
}

// Le o WAV e devolve as amostras (Float32) sem carregar tudo em dobro.
function lerWav(buf) {
  let ini = 12;
  while (ini < buf.length - 8 && buf.toString('ascii', ini, ini + 4) !== 'data') ini += 8 + buf.readUInt32LE(ini + 4);
  ini += 8;
  const n = Math.floor((buf.length - ini) / 2);
  const s = new Float32Array(n);
  for (let k = 0; k < n; k++) s[k] = buf.readInt16LE(ini + k * 2) / 32768;
  return s;
}

module.exports = { sirenePorSegundo, trechos, lerWav, tonsPorQuadro };
