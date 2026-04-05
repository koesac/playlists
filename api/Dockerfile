FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY backfillLibrary.js ./
COPY backfill-artwork.js ./

EXPOSE 3001

CMD ["npm", "start"]
