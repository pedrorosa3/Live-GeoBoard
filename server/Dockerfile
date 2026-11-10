# Usa uma imagem leve do Node.js
FROM node:20-alpine

# Define a diretoria de trabalho dentro do contentor
WORKDIR /app

# Copia apenas os ficheiros de dependências primeiro (otimiza a cache do Docker)
COPY package*.json ./
RUN npm install

# Copia o resto do código
COPY . .

# Expõe a porta que o Express está a usar
EXPOSE 3000

# Comando para arrancar o servidor
CMD ["node", "index.js"]