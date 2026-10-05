# The public Paint Party demo (Fly.io). Build from the repo root:
#   docker build -f deploy/fly/Dockerfile -t joinstick-demo .
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY llms.txt AGENTS.md PROTOCOL.md LICENSE THIRD_PARTY_NOTICES.md ./
COPY examples/paint-party /site/demo/paint-party
RUN echo '<!doctype html><meta http-equiv="refresh" content="0; url=/demo/paint-party/"><a href="/demo/paint-party/">Paint Party</a>' > /site/index.html
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/cli.js", "--static", "/site"]
