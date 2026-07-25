FROM node:20-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json .
COPY package-lock.json .        
RUN npm install
COPY server.cjs .
COPY providers ./providers
EXPOSE 8080
CMD ["node", "server.cjs"]