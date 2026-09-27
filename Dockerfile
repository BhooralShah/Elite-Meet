FROM node:18-alpine

# FFmpeg install karein (recording merge ke liye zaroori)
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Render PORT environment variable inject karta hai, usko use karein
ENV PORT=10000
EXPOSE 10000

CMD ["node", "server/index.js"]
