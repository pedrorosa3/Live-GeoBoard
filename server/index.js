require('dotenv').config(); // Carrega as variáveis do ficheiro .env
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('Falta a variável JWT_SECRET no ficheiro .env');
  process.exit(1);
}

const CATEGORIES = ['blue', 'red', 'green', 'orange', 'violet'];

const app = express();
app.use(cors({ origin: 'http://localhost:4200' }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: 'http://localhost:4200' }
});

// 1. Ligação Segura ao MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Ligado ao MongoDB Atlas com sucesso!'))
  .catch((err) => console.error('Erro ao ligar ao MongoDB:', err));

// 2. Modelos de Dados
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 30 },
  passwordHash: { type: String, required: true }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

const pointSchema = new mongoose.Schema({
  lat: { type: Number, required: true, min: -90, max: 90 },
  lng: { type: Number, required: true, min: -180, max: 180 },
  title: { type: String, required: true, trim: true, maxlength: 100 },
  category: { type: String, enum: CATEGORIES, default: 'blue' },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

const Point = mongoose.model('Point', pointSchema);

// Devolve o ponto num formato simples, com o nome de quem o criou
// (o campo owner tem de estar populado)
function formatPoint(point) {
  return {
    _id: point._id,
    lat: point.lat,
    lng: point.lng,
    title: point.title,
    category: point.category,
    owner: point.owner ? { _id: point.owner._id, username: point.owner.username } : null,
    createdAt: point.createdAt,
    updatedAt: point.updatedAt
  };
}

async function toPublicPoint(point) {
  await point.populate('owner', 'username');
  return formatPoint(point);
}

function createToken(user) {
  return jwt.sign({ sub: user._id.toString(), username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

function validateCredentials(body) {
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
    return { error: 'O nome de utilizador deve ter 3 a 30 caracteres (letras, números, _ . -).' };
  }
  if (password.length < 6 || password.length > 100) {
    return { error: 'A password deve ter pelo menos 6 caracteres.' };
  }
  return { username, password };
}

// 3. Rotas de Autenticação
app.post('/api/auth/register', async (req, res) => {
  const creds = validateCredentials(req.body);
  if (creds.error) return res.status(400).json({ error: creds.error });

  try {
    const exists = await User.exists({ username: creds.username });
    if (exists) return res.status(409).json({ error: 'Esse nome de utilizador já existe.' });

    const passwordHash = await bcrypt.hash(creds.password, 10);
    const user = await User.create({ username: creds.username, passwordHash });
    res.status(201).json({ token: createToken(user), user: { _id: user._id, username: user.username } });
  } catch (error) {
    console.error('Erro no registo:', error);
    res.status(500).json({ error: 'Erro ao criar a conta.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const creds = validateCredentials(req.body);
  if (creds.error) return res.status(401).json({ error: 'Utilizador ou password inválidos.' });

  try {
    const user = await User.findOne({ username: creds.username });
    const valid = user && await bcrypt.compare(creds.password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Utilizador ou password inválidos.' });

    res.json({ token: createToken(user), user: { _id: user._id, username: user.username } });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro ao iniciar sessão.' });
  }
});

// 4. Rota para ir buscar todos os pontos
app.get('/api/points', async (req, res) => {
  try {
    const points = await Point.find().populate('owner', 'username');
    res.json(points.map(formatPoint));
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar pontos' });
  }
});

// 5. WebSockets
// Quem não tem sessão iniciada pode ver o mapa, mas não pode alterar pontos.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      socket.data.user = { id: payload.sub, username: payload.username };
    } catch {
      // Token inválido ou expirado: a ligação continua como anónima
    }
  }
  next();
});

function cleanTitle(title) {
  return typeof title === 'string' ? title.trim().slice(0, 100) : '';
}

function cleanCategory(category) {
  return CATEGORIES.includes(category) ? category : 'blue';
}

// Garante que existe sessão e que o ponto pertence a quem fez o pedido
async function findOwnedPoint(socket, id) {
  if (!socket.data.user) return { error: 'Tens de iniciar sessão.' };
  if (!mongoose.isValidObjectId(id)) return { error: 'Ponto inválido.' };

  const point = await Point.findById(id);
  if (!point) return { error: 'O ponto já não existe.' };
  if (!point.owner || point.owner.toString() !== socket.data.user.id) {
    return { error: 'Só quem criou o ponto o pode alterar.' };
  }
  return { point };
}

io.on('connection', (socket) => {
  console.log('Novo cliente conectado:', socket.id, socket.data.user ? `(${socket.data.user.username})` : '(anónimo)');

  socket.on('new_point', async (data, ack = () => {}) => {
    try {
      if (!socket.data.user) return ack({ error: 'Tens de iniciar sessão para adicionar pontos.' });

      const title = cleanTitle(data?.title);
      if (!title) return ack({ error: 'O ponto precisa de um nome.' });

      const point = await Point.create({
        lat: data?.lat,
        lng: data?.lng,
        title,
        category: cleanCategory(data?.category),
        owner: socket.data.user.id
      });
      const publicPoint = await toPublicPoint(point);
      io.emit('point_added', publicPoint); // Envia para todos os clientes
      ack({ ok: true, point: publicPoint });
    } catch (error) {
      console.error('Erro ao gravar ponto:', error);
      ack({ error: 'Erro ao gravar o ponto.' });
    }
  });

  socket.on('update_point', async (data, ack = () => {}) => {
    try {
      const { point, error } = await findOwnedPoint(socket, data?.id);
      if (error) return ack({ error });

      const title = cleanTitle(data?.title);
      if (!title) return ack({ error: 'O ponto precisa de um nome.' });

      point.title = title;
      point.category = cleanCategory(data?.category);
      await point.save();

      const publicPoint = await toPublicPoint(point);
      io.emit('point_updated', publicPoint);
      ack({ ok: true, point: publicPoint });
    } catch (error) {
      console.error('Erro ao editar ponto:', error);
      ack({ error: 'Erro ao editar o ponto.' });
    }
  });

  socket.on('delete_point', async (data, ack = () => {}) => {
    try {
      const { point, error } = await findOwnedPoint(socket, data?.id);
      if (error) return ack({ error });

      await point.deleteOne();
      io.emit('point_removed', { _id: point._id });
      ack({ ok: true });
    } catch (error) {
      console.error('Erro ao remover ponto:', error);
      ack({ error: 'Erro ao remover o ponto.' });
    }
  });
});

server.listen(3000, () => console.log('Servidor a correr na porta 3000'));
