# Сборка статики и раздача через nginx. Собирается из корня репозитория.
FROM python:3.12-alpine AS build
WORKDIR /src
COPY site ./site
ARG DEMO_URL=https://demo.hoolee.uz
ENV DEMO_URL=$DEMO_URL
RUN python3 site/build.py

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 80
