FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY data/seed/courses.json data/seed/videos.json data/seed/paths.json ./data/seed/
COPY client/src/constants.js ./client/src/constants.js

ENV PORT=8080
ENV NODE_ENV=production
CMD ["node", "server/index.js"]
