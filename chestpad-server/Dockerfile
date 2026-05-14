FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY server.cjs .
EXPOSE 8080
CMD ["node", "server.cjs"]