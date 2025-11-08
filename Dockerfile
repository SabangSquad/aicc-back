# aicc-back/dockerfile
FROM node:22-slim

ENV NODE_ENV=development \
    PORT=3000

WORKDIR /app

COPY package*.json ./
RUN npm ci

# nodemon으로 핫리로드
# 컨테이너 실행 시 소스는 바인드 마운트
COPY src ./src

EXPOSE 3000

CMD ["npx", "nodemon", "--watch", "src", "--ext", "js,mjs,json", "--exec", "node", "src/app.js"]