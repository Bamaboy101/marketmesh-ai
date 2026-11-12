FROM node:20-alpine
WORKDIR /usr/src/app
COPY package.json ./
RUN npm install --omit=dev
COPY dist ./dist
EXPOSE 5173
ENV VITE_API_BASE=http://localhost:4000
CMD ["npm", "run", "preview", "--", "--host"]
