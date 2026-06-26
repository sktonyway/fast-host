FROM node:24-alpine

WORKDIR /app

COPY package*.json .

RUN npm i

COPY index.js .

CMD ["npm", "start"]