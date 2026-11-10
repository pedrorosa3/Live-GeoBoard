require('dotenv').config(); // Carrega as variáveis do ficheiro .env
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: 'http://localhost:4200' }
});

// 1. Ligação Segura ao MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Ligado ao MongoDB Atlas com sucesso!'))
  .catch((err) => console.error('Erro ao ligar ao MongoDB:', err));

// 2. Definição do Esquema de Dados (Model)
const pointSchema = new mongoose.Schema({
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  title: { type: String, required: true },
  category: { type: String, default: 'blue' }
}, { timestamps: true });

const Point = mongoose.model('Point', pointSchema);

// 3. Atualizar a Rota para ir buscar dados reais à Base de Dados
app.get('/api/points', async (req, res) => {
  try {
    const points = await Point.find(); // Busca todos os pontos
    res.json(points);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar pontos' });
  }
});

// 4. Atualizar o WebSocket para gravar na Base de Dados antes de emitir
io.on('connection', (socket) => {
  console.log('Novo cliente conectado:', socket.id);

  socket.on('new_point', async (data) => {
    try {
      const newPoint = new Point(data);
      const savedPoint = await newPoint.save(); // Grava no Atlas
      io.emit('point_added', savedPoint);       // Envia para todos os clientes
    } catch (error) {
      console.error('Erro ao gravar ponto:', error);
    }
  });
});

server.listen(3000, () => console.log('Servidor a correr na porta 3000'));