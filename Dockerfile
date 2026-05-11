# aicc-back/Dockerfile — production image
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=4000

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts

EXPOSE 4000

CMD ["node", "src/app.js"]
