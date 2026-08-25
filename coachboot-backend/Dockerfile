# CoachBoot Enterprise — Backend (Express + PostgreSQL)
#
# Image Node uniquement : le pipeline CoachBoot IA (ml/train.py, ml/predict.py)
# nécessite Python 3.12 + pandas/numpy/scikit-learn, volontairement PAS installé
# ici pour garder l'image légère. Sans Python dans le conteneur, POST /api/ml/train
# et /api/ml/predict échouent proprement avec un message d'erreur clair (voir
# ml.routes.js) — le reste de l'API fonctionne normalement. Pour activer l'IA en
# conteneur, étendre cette image avec `apt-get install python3 python3-pip` et
# `pip install -r ml/requirements.txt`, puis définir PYTHON_BIN=python3.
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

# Créés au premier entraînement sinon (voir ml.routes.js) — les prévoir ici
# évite un échec de permission si l'utilisateur applicatif n'a pas le droit
# de créer des dossiers dans l'image.
RUN mkdir -p ml/models ml/uploads

ENV NODE_ENV=production
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
