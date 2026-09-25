# Postador de Clipes

Painel pra trazer clipes (PC, Twitch, Kick, links), cortar lives com transições e memes,
montar vídeos longos automáticos com thumbnail e postar no YouTube, Instagram, Facebook,
TikTok e X, com métricas de tudo.

## Login

Na primeira vez o painel cria o admin: usuario `admin`, senha `admin` no PC (na nuvem, a senha e o codigo `SENHA_PAINEL`). O primeiro login obriga a trocar a senha (e da pra trocar o usuario).
Depois, na aba **Acesso**: trocar senha, ver e desconectar aparelhos, criar usuarios (admin ou editor).
Editor corta, posta e ve metricas, mas nao mexe nas contas das redes nem em usuarios.

## Rodar no PC

```
node server.js
```

Abre em http://localhost:8790. Precisa do Node 20+ e do ffmpeg (`winget install Gyan.FFmpeg`).
No PC também tem login, e o painel só aceita conexão do próprio computador.

## Rodar no Railway

1. **New Project → Deploy from GitHub repo** → escolha este repositório. O Railway usa o `Dockerfile`.
2. **Volume:** no serviço, *Settings → Volumes → Add Volume*, com o caminho de montagem **`/data`**.
   É ali que ficam as contas conectadas, os clipes e as análises (sem volume, tudo some a cada deploy).
3. **Variáveis** (*Variables*):
   - `SENHA_PAINEL` (opcional) = código de instalação. Se não criar, o painel gera um sozinho e mostra nos logs do deploy (linha "CODIGO DE INSTALACAO")
   - `BASE_URL` = o endereço público do serviço, ex.: `https://postador-production.up.railway.app`
     (se não colocar, usa o domínio do Railway automaticamente)
4. **Domínio:** *Settings → Networking → Generate Domain*.
5. Entre com `admin` e o código de instalação (logs do deploy), crie sua senha e conecte as redes na aba **Contas**.

### Endereços de retorno (login das redes)

Cadastre `BASE_URL/oauth/<rede>/callback` em cada rede:

| Rede | Onde cadastrar | Endereço |
|---|---|---|
| YouTube | Google Cloud → Credenciais → **criar um ID do cliente OAuth do tipo "Aplicativo da Web"** (o tipo "App para computador" só aceita localhost) → URIs de redirecionamento autorizados | `BASE_URL/oauth/youtube/callback` |
| TikTok | developers.tiktok.com → app → Login Kit → Redirect URI | `BASE_URL/oauth/tiktok/callback` |
| Twitch | dev.twitch.tv/console/apps → Gerenciar → URLs de redirecionamento | `BASE_URL/oauth/twitch/callback` |
| X | developer.x.com → app → User authentication settings → Callback URI | `BASE_URL/oauth/x/callback` |
| Facebook/Instagram | não precisa (usa o token do Graph API Explorer) | — |

### O que muda na nuvem

- Thumbnails usam fontes livres (Liberation/DejaVu) no lugar da Arial Black do Windows.
- "Trazer pelo caminho do PC" não funciona na nuvem: use o envio de arquivo.
- Legenda automática (whisper) só no PC por enquanto.
- Analisar live inteira e renderizar vídeo longo usam bastante CPU; no Railway isso conta no consumo do plano.
