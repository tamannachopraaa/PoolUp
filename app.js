// app.js
// Import necessary modules
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
const helmet = require('helmet');
// --- REDIS IMPORT ---
const redis = require('redis'); 

// Load environment variables
dotenv.config();

const app = express();

// --- Server & WebSocket Setup ---
// We create the server here so it can be exported for testing
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- REDIS PUB/SUB CLIENTS (for scaling the chat) ---
// Use environment variable for Redis URL if available, otherwise default to local
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// 1. Publisher Client (To send messages to Redis channels)
const publisher = redis.createClient({ url: REDIS_URL });
publisher.connect().then(() => console.log('Redis Publisher Connected')).catch(err => console.error('Redis Publisher Error:', err));

// 2. Subscriber Client (To receive messages from Redis channels)
const subscriber = redis.createClient({ url: REDIS_URL });
subscriber.connect().then(() => console.log('Redis Subscriber Connected')).catch(err => console.error('Redis Subscriber Error:', err));

// --- In-memory store for tracking LOCAL WebSocket connections ---
const localConnections = new Map(); // Key: carpoolId, Value: Set of connected ws clients

const cacheClient = redis.createClient({ url: REDIS_URL });
cacheClient.connect().catch(console.error);

module.exports = { app, server };

function broadcastToLocalClients(carpoolId, message) {
    if (!localConnections.has(carpoolId)) return;
    localConnections.get(carpoolId).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
}

// ----------------------------------------------------

// --- Middleware ---
//app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(cookieParser());

const session = require('express-session');
const RedisStore = require('connect-redis')(session);

const redisStore = new RedisStore({
    client: cacheClient,
    prefix: "sess:",
});

app.use(session({
    store: redisStore,
    secret: process.env.SESSION_SECRET || "super-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24,
    },
}));

app.use(express.static(path.join(__dirname, 'public')));

// Import Models and Middleware
const User = require('./models/User');
const Carpool = require('./models/Carpool');
const Chat = require('./models/Chat');
const { auth, admin } = require('./middleware/auth');

// --- Global Middleware for User (No change needed here) ---
app.use((req, res, next) => {
    const token = req.cookies.token;
    if (token) {
        try {
            const verifiedUser = jwt.verify(token, process.env.JWT_SECRET);
            res.locals.user = verifiedUser;
            req.user = verifiedUser; 
        } catch (ex) {
            res.locals.user = null;
            req.user = null;
        }
    } else {
        res.locals.user = null;
        req.user = null;
    }
    next();
});

// --- EJS Layouts Configuration ---
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layouts/main');

// --- ROUTES ---

// Main Route
app.get('/', async (req, res) => {
    try {
        if (!res.locals.user) {
            return res.render('home', { title: 'Welcome', carpools: [] });
        }

        // Try cache first
        const cacheKey = "carpools:list";
        const cached = await cacheClient.get(cacheKey);

        if (cached) {
            console.log("Serving carpools from Redis cache");
            return res.render('home', { title: 'Dashboard', carpools: JSON.parse(cached) });
        }

        // Not cached → fetch from Mongo
        const carpools = await Carpool.find()
            .sort({ createdAt: -1 })
            .populate('userId', 'name email')
            // populate the user inside bookedBy subdocs
            .populate('bookedBy.user', 'name');

        // Store in cache for 30 seconds
        await cacheClient.setEx(cacheKey, 30, JSON.stringify(carpools));

        res.render('home', { title: 'Dashboard', carpools });

    } catch (err) {
        console.error(err);
        res.status(500).send("Server error loading page.");
    }
});

// Auth Routes (Login, Register, Logout)
app.get('/auth/login-register', (req, res) => res.render('auth/login-register', { title: 'Login / Register', error: null, message: null }));
app.post('/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        await User.create({ name, email, password });
        res.render('auth/login-register', { title: 'Login / Register', message: 'Registration successful. Please log in.', error: null });
    } catch (err) {
        res.render('auth/login-register', { title: 'Login / Register', error: 'User already exists.', message: null });
    }
});
app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user || !(await user.comparePassword(password))) {
            return res.render('auth/login-register', { title: 'Login / Register', error: 'Invalid credentials.', message: null });
        }
        const token = jwt.sign({ id: user._id, role: user.role, name: user.name, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
        res.redirect('/');
    } catch (err) {
        res.render('auth/login-register', { title: 'Login / Register', error: 'Server error.', message: null });
    }
});
app.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/auth/login-register');
});

// Admin Routes
app.get('/admin/manage-offers', auth, admin, async (req, res) => {
    const carpools = await Carpool.find().populate('userId', 'name email');
    res.render('admin/manage-offers', { title: 'Manage Offers', carpools });
});
app.delete('/admin/offers/:id', auth, admin, async(req, res) => {
    await Carpool.findByIdAndDelete(req.params.id);
    res.redirect('/admin/manage-offers');
});

// Carpool Routes
app.get('/carpools/new', auth, (req, res) => { 
    res.render('user/create-offer', { title: 'Create Offer' });
});
app.post('/carpools', auth, async (req, res) => { 
    const { carName, location, time, price, gender, totalSeats } = req.body;
    try {
        await Carpool.create({ userId: res.locals.user.id, carName, location, time, price, gender, totalSeats, bookedSeats: 0, bookedBy: [] });
        await cacheClient.del("carpools:list");

        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error.');
    }
});

// Booking route - now supports selecting seats (req.body.seats)
app.post('/carpools/:id/book', auth, async (req, res) => { 
    try {
        const seatsRequested = parseInt(req.body.seats, 10) || 1;
        if (seatsRequested < 1) {
            return res.status(400).send('Invalid number of seats requested.');
        }

        const carpool = await Carpool.findById(req.params.id).populate('bookedBy.user', 'name');

        if (!carpool) {
            return res.status(404).send('Carpool not found.');
        }

        // prevent driver booking their own offer
        if (carpool.userId.equals(req.user.id)) {
            return res.status(400).send('You cannot book your own offer.');
        }

        // check if user already has a booking
        const existingBooking = carpool.bookedBy.find(b => b.user && String(b.user._id || b.user) === String(req.user.id));
        if (existingBooking) {
            return res.status(400).send('You have already booked seats for this carpool.');
        }

        const available = (carpool.totalSeats || 0) - (carpool.bookedSeats || 0);
        if (seatsRequested > available) {
            return res.status(400).send(`Only ${available} seat(s) available.`);
        }

        // update atomically: increment bookedSeats and push booking subdoc
        await Carpool.findByIdAndUpdate(req.params.id, {
            $inc: { bookedSeats: seatsRequested },
            $push: { bookedBy: { user: req.user.id, seats: seatsRequested } }
        });

        try { await cacheClient.del("carpools:list"); } catch (e) { /* ignore cache errors */ }

        return res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error.');
    }
});

// Cancel booking route - removes user's booking and frees up their seats
app.post('/carpools/:id/cancel', auth, async (req, res) => { 
    try {
        const carpool = await Carpool.findById(req.params.id);

        if (!carpool) {
            return res.status(404).send('Carpool not found.');
        }

        const userBooking = carpool.bookedBy.find(b => b.user && String(b.user) === String(req.user.id) || b.user && String(b.user._id) === String(req.user.id));

        if (!userBooking) {
            return res.redirect('/');
        }

        const seatsToFree = (userBooking.seats && Number(userBooking.seats)) || 1;

        await Carpool.findByIdAndUpdate(req.params.id, {
            $inc: { bookedSeats: -seatsToFree },
            $pull: { bookedBy: { user: req.user.id } }
        });

        try { await cacheClient.del("carpools:list"); } catch (e) { /* ignore cache errors */ }

        return res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error.');
    }
});

// Chat Route 
app.get('/chat/:carpoolId', auth, async (req, res) => {
    const messages = await Chat.find({ carpoolId: req.params.carpoolId }).populate('sender', 'name');
    res.render('chat/chat', { title: 'Chat', carpoolId: req.params.carpoolId, messages });
});

// --- WebSocket Logic  ---
wss.on('connection', ws => {
    console.log('Client connected to WebSocket');
    
    ws.carpoolId = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            const { type, carpoolId, userId, name, message: messageText } = data;

            if (type === 'join') {
                if (ws.carpoolId && localConnections.has(ws.carpoolId)) {
                    localConnections.get(ws.carpoolId).delete(ws);

                    if (localConnections.get(ws.carpoolId).size === 0) {
                        try {
                            await subscriber.unsubscribe(ws.carpoolId);
                        } catch (err) {
                            console.error(`Unsubscribe failed for ${ws.carpoolId}:`, err);
                        }
                        localConnections.delete(ws.carpoolId);
                    }
                }

                ws.carpoolId = carpoolId;

                if (!localConnections.has(carpoolId)) {
                    try {
                        await subscriber.subscribe(carpoolId, (payload) => {
                            broadcastToLocalClients(carpoolId, payload);
                        });
                        console.log(`Subscribed to Redis channel ${carpoolId}`);
                    } catch (err) {
                        console.error(`Subscribe error for ${carpoolId}:`, err);
                    }

                    localConnections.set(carpoolId, new Set());
                }

                localConnections.get(carpoolId).add(ws);
                console.log(`Client ${userId} joined ${carpoolId}`);
                return;
            }

            if (type === 'chat') {
                // Save the message to the database
                const newChatMessage = new Chat({
                    carpoolId: carpoolId,
                    sender: userId,
                    message: messageText,
                });
                await newChatMessage.save();

                // Prepare the message to broadcast back to the room
                const broadcastMessage = JSON.stringify({
                    type: 'message',
                    name: name,
                    message: messageText,
                });

                // Publish the message to Redis channel
                await publisher.publish(carpoolId, broadcastMessage);
            }
        } catch (error) {
            console.error('Failed to process message or save to DB:', error);
        }
    });

    ws.on('close', async () => {
        if (ws.carpoolId && localConnections.has(ws.carpoolId)) {
            const set = localConnections.get(ws.carpoolId);
            set.delete(ws);

            if (set.size === 0) {
                try {
                    await subscriber.unsubscribe(ws.carpoolId);
                } catch (err) {
                    console.error(`Unsubscribe error for ${ws.carpoolId}:`, err);
                }
                localConnections.delete(ws.carpoolId);
                console.log(`Room ${ws.carpoolId} now empty`);
            }
        }
    });

});

// --- EXPORT THE APP AND SERVER ---
module.exports = { app, server };
