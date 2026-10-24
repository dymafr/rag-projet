# L'image de Rhéa (chapitre 14, leçon 10) : une seule, pour le serveur, le travailleur, les migrations et l'ingestion ;
# le compose de production choisit la commande de chaque service. Versions figées : une image reconstruite demain doit
# être la même qu'aujourd'hui (Node 24, LTS de maintenance jusqu'au 30 avril 2028)

# 1. L'interface (Vite) se construit à part : on n'en garde que web/dist, sans ses outils de construction
FROM node:24.22.1-trixie-slim AS interface
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web ./web
COPY src ./src
RUN npm run web:construire

# 2. L'image finale : les dépendances de production seulement, le code, les prompts, l'interface construite
FROM node:24.22.1-trixie-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY prompts ./prompts
COPY eval/tarifs.json ./eval/tarifs.json
COPY --from=interface /app/web/dist ./web/dist
# Les dossiers où Rhéa écrit (les fichiers dérivés du corpus, le journal), à l'utilisateur sans droits qui la fait tourner.
# Le corpus, lui, n'est pas dans l'image : le compose le monte en lecture seule, pour le mettre à jour sans reconstruire
# (et le cache de Transformers.js : le tokenizer du découpage, et les modèles locaux s'ils servent, téléchargés au premier usage)
RUN mkdir -p donnees journal node_modules/@huggingface/transformers/.cache \
  && chown node:node donnees journal node_modules/@huggingface/transformers/.cache
USER node
EXPOSE 3000
CMD ["node", "src/outils/lancer-serveur.ts"]
