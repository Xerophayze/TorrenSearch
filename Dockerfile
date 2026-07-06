FROM node:22-alpine

WORKDIR /app

COPY index.html README.md server.js ./

ENV HOST=0.0.0.0
ENV PORT=8787

EXPOSE 8787

CMD ["node", "server.js"]
