// Import necessary modules
const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const methodOverride = require('method-override');
const cookieParser = require('cookie-parser');
const expressLayouts = require('express-ejs-layouts');

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Import Models and Middleware
const User = require('./models/User');
const Carpool = require('./models/Carpool');
const Chat = require('./models/Chat');
const { auth, admin } = require('./middleware/auth');

// In-memory store for chat rooms
const chatRooms = new Map();

// Admin creation
const createAdmin = async () => {
    try {
        const adminExists = await User.findOne({ email: process.env.ADMIN_EMAIL });
        if (!adminExists) {
            await User.create({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, role: 'admin', name: 'Admin User' });
            console.log('Admin user created successfully');
        } else {
            console.log('Admin user already exists.');
        }
    } catch (err) {
        console.error('Error creating admin:', err.message);
    }
};

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
.then(() => {
    console.log('MongoDB connected successfully');
    createAdmin();
})
.catch(err => console.error('MongoDB connection error:', err));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Global Middleware to pass user to templates
app.use((req, res, next) => {
    const token = req.cookies.token;
    if (token) {
        try {
            res.locals.user = jwt.verify(token, process.env.JWT_SECRET);
        } catch (ex) {
            res.locals.user = null;
        }
    } else {
        res.locals.user = null;
    }
    next();
});

// EJS Layouts configuration
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layouts/main');

// --- ROUTES ---

// Main Route (Handles dashboard and landing page views)
app.get('/', async (req, res) => {
    try {
        if (res.locals.user) {
            const carpools = await Carpool.find()
                .sort({ createdAt: -1 })
                .populate('userId', 'name email')
                .populate('bookedBy', 'name'); 
            return res.render('home', { title: 'Dashboard', carpools });
        }
        res.render('home', { title: 'Welcome', carpools: [] });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error loading page.");
    }
});

// Auth Routes
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
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error.');
    }
});

app.post('/carpools/:id/book', auth, async (req, res) => { 
    try {
        const carpool = await Carpool.findById(req.params.id);
        const userHasBooked = carpool && carpool.bookedBy.some(bookerId => bookerId.equals(req.user.id));

        if (carpool && !carpool.userId.equals(req.user.id) && carpool.bookedSeats < carpool.totalSeats && !userHasBooked) {
            await Carpool.findByIdAndUpdate(req.params.id, { 
                $inc: { bookedSeats: 1 },
                $push: { bookedBy: req.user.id } 
            });
        }
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error.');
    }
});

app.post('/carpools/:id/cancel', auth, async (req, res) => { 
    try {
        const carpool = await Carpool.findById(req.params.id);
        const userHasBooked = carpool && carpool.bookedBy.some(bookerId => bookerId.equals(req.user.id));
        
        if (userHasBooked) {
            await Carpool.findByIdAndUpdate(req.params.id, { 
                $inc: { bookedSeats: -1 },
                $pull: { bookedBy: req.user.id }
            });
        }
        res.redirect('/');
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

// WebSocket logic
wss.on('connection', ws => {
    console.log('Client connected to WebSocket');
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            const { type, carpoolId, userId, name, message: messageText } = data;

            if (type === 'join') {
                if (!chatRooms.has(carpoolId)) {
                    chatRooms.set(carpoolId, new Set());
                }
                chatRooms.get(carpoolId).add(ws);
                console.log(`Client ${userId} joined room ${carpoolId}`);
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
                    message: messageText
                });

                if (chatRooms.has(carpoolId)) {
                    chatRooms.get(carpoolId).forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(broadcastMessage);
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Failed to process message or save to DB:', error);
        }
    });

    ws.on('close', () => {
        chatRooms.forEach(clients => clients.delete(ws));
        console.log('Client disconnected');
    });
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));