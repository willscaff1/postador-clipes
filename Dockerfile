# Postador de clipes na nuvem (Railway).
# Debian trixie traz ffmpeg 7 (xfade, drawtext com alinhamento) e fontes livres
# no lugar das fontes do Windows usadas no PC.
FROM node:22-trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates fonts-dejavu-core fonts-liberation2 yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production \
    POSTADOR_NUVEM=1 \
    DADOS_DIR=/data

# /data deve ser um Volume do Railway (contas conectadas, clipes e analises)
EXPOSE 8080
CMD ["node", "server.js"]
