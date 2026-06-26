FROM node:24-alpine

WORKDIR /app

COPY package*.json .
COPY index.js .

RUN npm i

COPY index.js .

CMD ["npm", "start"]