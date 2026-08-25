# CoachBoot Enterprise — Frontend (statique, aucun build)
# Sert directement les fichiers .html/.css/.js existants via nginx — le
# frontend n'a jamais eu besoin d'un bundler (voir docs/README.md), donc
# aucune étape de build ici, juste une copie + un serveur de fichiers.
FROM nginx:alpine

COPY . /usr/share/nginx/html

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost/index.html || exit 1

EXPOSE 80
