FROM node:20-alpine

WORKDIR /app

# Copia package files e installa dipendenze
COPY package.json package-lock.json* ./
RUN npm install

# Copia il resto dei file
COPY . .

# Crea utente non-root
RUN adduser -D appuser && chown -R appuser:appuser /app
USER appuser

# Esponi la porta di Vite
EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:5173/ || exit 1

# Avvia il dev server con hot-reload
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
