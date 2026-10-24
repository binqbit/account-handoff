FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node serve.mjs ./
COPY --chown=node:node www/ ./www/
USER node
ENV AH_HOST=0.0.0.0 AH_PORT=8080
EXPOSE 8080
CMD ["node", "serve.mjs"]
