// ================== IMPORTS ==================
const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const methodOverride = require('method-override');
const cookieParser = require('cookie-parser');
const expressLayouts = require('express-ejs-layouts');
const morgan = require('morgan');
const redis = require('redis');

// ================== CONFIG ==================
dotenv.config();

const app = express();
app.set('trust proxy', 1);

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ================== MONGODB CONNECT (FIX) ==================
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
  });

// ================== REDIS ==================
const REDIS_URL = process.env.REDIS_URL;
const publisher = redis.createClient({ url: REDIS_URL });
const subscriber = redis.createClient({ url: REDIS_URL });
const cacheClient = redis.createClient({ url: REDIS_URL });

(async () => {
  try {
    await publisher.connect();
    await subscriber.connect();
    await cacheClient.connect();
    console.log('✅ Redis Connected');
  } catch (err) {
    console.error('❌ Redis error:', err);
  }
})();

// ================== MIDDLEWARE ==================
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ================== EJS ==================
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layouts/main');

// ================== MODELS ==================
const User = require('./models/User');
const Carpool = require('./models/Carpool');
const Chat = require('./models/Chat');
const { auth, admin } = require('./middleware/auth');

// ================== GLOBAL AUTH ==================
app.use((req, res, next) => {
  const token = req.cookies.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      res.locals.user = decoded;
    } catch {
      req.user = null;
      res.locals.user = null;
    }
  } else {
    req.user = null;
    res.locals.user = null;
  }
  next();
});

// ================== ROUTES ==================

// HOME
app.get('/', async (req, res) => {
  try {
    if (!req.user) {
      return res.render('home', { title: 'Welcome', carpools: [] });
    }

    const cached = await cacheClient.get('carpools:list');
    if (cached) {
      return res.render('home', {
        title: 'Dashboard',
        carpools: JSON.parse(cached),
      });
    }

    const carpools = await Carpool.find()
      .sort({ createdAt: -1 })
      .populate('userId', 'name email')
      .populate('bookedBy.user', 'name');

    await cacheClient.setEx('carpools:list', 30, JSON.stringify(carpools));
    res.render('home', { title: 'Dashboard', carpools });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ================== AUTH ==================
app.get('/auth/login-register', (req, res) => {
  res.render('auth/login-register', {
    title: 'Login / Register',
    error: null,
    message: null,
  });
});

// REGISTER
app.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    await User.create({ name, email, password });
    res.render('auth/login-register', {
      title: 'Login / Register',
      message: 'Registration successful. Please login.',
      error: null,
    });
  } catch (err) {
    console.error(err);
    res.render('auth/login-register', {
      title: 'Login / Register',
      error: 'User already exists',
      message: null,
    });
  }
});

// LOGIN
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.render('auth/login-register', {
        title: 'Login / Register',
        error: 'Invalid credentials',
        message: null,
      });
    }

    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        name: user.name,
        email: user.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.render('auth/login-register', {
      title: 'Login / Register',
      error: 'Server error',
      message: null,
    });
  }
});

// LOGOUT
app.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/auth/login-register');
});

// ================== WEBSOCKET ==================
const localConnections = new Map();

function broadcast(room, msg) {
  if (!localConnections.has(room)) return;
  for (const ws of localConnections.get(room)) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

wss.on('connection', ws => {
  ws.room = null;

  ws.on('message', async raw => {
    const data = JSON.parse(raw);

    if (data.type === 'join') {
      ws.room = data.carpoolId;
      if (!localConnections.has(ws.room)) {
        localConnections.set(ws.room, new Set());
        await subscriber.subscribe(ws.room, msg =>
          broadcast(ws.room, msg)
        );
      }
      localConnections.get(ws.room).add(ws);
    }

    if (data.type === 'chat') {
      await Chat.create({
        carpoolId: data.carpoolId,
        sender: data.userId,
        message: data.message,
      });

      await publisher.publish(
        data.carpoolId,
        JSON.stringify({
          name: data.name,
          message: data.message,
        })
      );
    }
  });

  ws.on('close', async () => {
    if (!ws.room) return;
    localConnections.get(ws.room)?.delete(ws);
    if (localConnections.get(ws.room)?.size === 0) {
      await subscriber.unsubscribe(ws.room);
      localConnections.delete(ws.room);
    }
  });
});

// ================== SERVER ==================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
