FROM node:22-alpine AS build

WORKDIR /app

COPY ui/package.json ui/package-lock.json ./ui/

WORKDIR /app/ui
RUN npm ci

WORKDIR /app
COPY shared ./shared
COPY ui ./ui

ARG VITE_ENDER_API=http://localhost:3000
ENV VITE_ENDER_API=${VITE_ENDER_API}

WORKDIR /app/ui
RUN npm run build

FROM nginx:1.27-alpine

COPY ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/ui/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
