# Joinstick in a container. Mount your game at /site and pass --public-url,
# because a container cannot see the host's LAN address:
#   docker run -p 3000:3000 -v "$PWD/my-game:/site:ro" joinstick --static /site --public-url http://<lan-ip>:3000
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY llms.txt AGENTS.md PROTOCOL.md LICENSE THIRD_PARTY_NOTICES.md ./
RUN ln -s /app/src/cli.js /usr/local/bin/joinstick && mkdir /site
USER node
ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["joinstick"]
CMD ["--static", "/site"]
