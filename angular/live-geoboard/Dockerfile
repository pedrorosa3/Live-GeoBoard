# ESTÁGIO 1: Build da aplicação Angular
FROM node:20-alpine as build
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
# Compila a aplicação para produção
RUN npm run build --configuration=production

# ESTÁGIO 2: Servidor Nginx para alojar os ficheiros estáticos
FROM nginx:alpine

# Copia o build gerado no estágio 1 para a pasta pública do Nginx
# (Nota: O Angular 17+ coloca os ficheiros dentro da pasta 'browser')
COPY --from=build /app/dist/live-geoboard/browser /usr/share/nginx/html

# Expõe a porta padrão da web
EXPOSE 80

# Arranca o Nginx
CMD ["nginx", "-g", "daemon off;"]