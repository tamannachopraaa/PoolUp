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

// ================== MONGODB ==================
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => {
    console.error('❌ MongoDB Error:', err);
    process.exit(1);
  });

// ================== REDIS ==================
const publisher = redis.createClient({ url: process.env.REDIS_URL });
const subscriber = redis.createClient({ url: process.env.REDIS_URL });
const cacheClient = redis.createClient({ url: process.env.REDIS_URL });

(async () => {
  try {
    await publisher.connect();
    await subscriber.connect();
    await cacheClient.connect();
    console.log('✅ Redis Connected');
  } catch (err) {
    console.error('❌ Redis Error:', err);
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
const { auth } = require('./middleware/auth');

// ================== GLOBAL AUTH ==================
app.use((req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    req.user = null;
    res.locals.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    res.locals.user = decoded;
  } catch {
    req.user = null;
    res.locals.user = null;
  }
  next();
});

// ================== ROUTES ==================

// HOME

// ================== ADMIN ==================
app.get('/admin/manage-offers', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).send('Forbidden');
  }

  const carpools = await Carpool.find().populate('userId', 'name email');
  res.render('admin/manage-offers', {
    title: 'Manage Offers',
    carpools,
  });
});

app.get('/admin/manage-users', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).send('Forbidden');
  }

  const users = await User.find();
  res.render('admin/manage-users', {
    title: 'Manage Users',
    users,
  });
});

app.delete('/admin/offers/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).send('Forbidden');
  }

  await Carpool.findByIdAndDelete(req.params.id);
  res.redirect('/admin/manage-offers');
});





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
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: true,      // Render = HTTPS
      sameSite: 'none',
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

app.get('/logout', (req, res) => {
  res.clearCookie('token', { secure: true, sameSite: 'none' });
  res.redirect('/auth/login-register');
});

// ================== CARPOOL ==================
app.get('/carpools/new', auth, (req, res) => {
  res.render('user/create-offer', { title: 'Create Offer' });
});

app.post('/carpools', auth, async (req, res) => {
  try {
    const { carName, location, time, price, gender, totalSeats } = req.body;

    const rideTime = new Date(time);
    if (rideTime <= new Date()) {
      return res.status(400).send('Ride time must be in future');
    }

    await Carpool.create({
      userId: req.user.id,
      carName,
      location,
      time,
      price,
      gender,
      totalSeats,
      bookedSeats: 0,
      bookedBy: [],
    });

    await cacheClient.del('carpools:list');
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to create carpool');
  }
});

app.post('/carpools/:id/book', auth, async (req, res) => {
  const seats = parseInt(req.body.seats || 1);
  const carpool = await Carpool.findById(req.params.id);

  if (!carpool) return res.status(404).send('Carpool not found');
  if (carpool.userId.equals(req.user.id))
    return res.status(400).send('Cannot book your own ride');

  const available = carpool.totalSeats - carpool.bookedSeats;
  if (seats > available)
    return res.status(400).send('Not enough seats');

  await Carpool.findByIdAndUpdate(req.params.id, {
    $inc: { bookedSeats: seats },
    $push: { bookedBy: { user: req.user.id, seats } },
  });

  await cacheClient.del('carpools:list');
  res.redirect('/');
});

app.post('/carpools/:id/cancel', auth, async (req, res) => {
  const carpool = await Carpool.findById(req.params.id);
  if (!carpool) return res.redirect('/');

  const booking = carpool.bookedBy.find(
    b => String(b.user) === String(req.user.id)
  );
  if (!booking) return res.redirect('/');

  await Carpool.findByIdAndUpdate(req.params.id, {
    $inc: { bookedSeats: -booking.seats },
    $pull: { bookedBy: { user: req.user.id } },
  });

  await cacheClient.del('carpools:list');
  res.redirect('/');
});

// ================== CHAT ==================
app.get('/chat/:carpoolId', auth, async (req, res) => {
  const messages = await Chat.find({
    carpoolId: req.params.carpoolId,
  }).populate('sender', 'name');

  res.render('chat/chat', {
    title: 'Chat',
    carpoolId: req.params.carpoolId,
    messages,
  });
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
        await subscriber.subscribe(ws.room, msg => broadcast(ws.room, msg));
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
        JSON.stringify({ name: data.name, message: data.message })
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
