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

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Import Models and Middleware
const User = require('./models/User');
const Carpool = require('./models/Carpool');
const { auth, admin } = require('./middleware/auth');

// Debugging console logs for admin credentials
console.log('ADMIN_EMAIL:', process.env.ADMIN_EMAIL);
console.log('ADMIN_PASSWORD:', process.env.ADMIN_PASSWORD);

// Hardcoded Admin creation (for demonstration)
const createAdmin = async () => {
    try {
        const adminExists = await User.findOne({ email: process.env.ADMIN_EMAIL });
        if (!adminExists) {
            const admin = new User({
                email: process.env.env.ADMIN_EMAIL,
                password: process.env.ADMIN_PASSWORD,
                role: 'admin',
                name: 'Admin User'
            });
            await admin.save();
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
.catch(err => {
    console.error('MongoDB connection error:', err);
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// New Global Middleware to make user available to all templates
app.use((req, res, next) => {
    const token = req.cookies.token;
    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            res.locals.user = decoded;
        } catch (ex) {
            res.locals.user = null;
        }
    } else {
        res.locals.user = null;
    }
    next();
});

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Routes ---
app.get('/', async (req, res) => {
    const token = req.cookies.token;
    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            if (decoded.role === 'admin') {
                const carpools = await Carpool.find().populate('userId', 'name');
                return res.render('admin/dashboard', { title: 'Admin Dashboard', carpools });
            } else {
                const carpools = await Carpool.find().populate('userId', 'name');
                return res.render('user/dashboard', { title: 'User Dashboard', carpools });
            }
        } catch (ex) {
            res.clearCookie('token');
            return res.render('auth/login-register', { title: 'Login / Register', error: null, message: null });
        }
    }
    res.render('auth/login-register', { title: 'Login / Register', error: null, message: null });
});

app.post('/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        let user = new User({ name, email, password });
        await user.save();
        res.render('auth/login-register', { title: 'Login / Register', message: 'Registration successful. Please log in.', error: null });
    } catch (err) {
        res.render('auth/login-register', { title: 'Login / Register', error: 'User already exists.', message: null });
    }
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    console.log('Login attempt for email:', email);
    try {
        const user = await User.findOne({ email });
        if (!user) {
            console.log('User not found.');
            return res.render('auth/login-register', { title: 'Login / Register', error: 'Invalid credentials.', message: null });
        }
        
        console.log('User found. Comparing passwords...');
        const isMatch = await user.comparePassword(password);
        
        if (!isMatch) {
            console.log('Password comparison failed. HASHES DO NOT MATCH.');
            return res.render('auth/login-register', { title: 'Login / Register', error: 'Invalid credentials.', message: null });
        }

        console.log('Password match successful! User authenticated.');
        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
        
        return res.redirect('/');
    } catch (err) {
        console.error('Server error during login:', err);
        res.render('auth/login-register', { title: 'Login / Register', error: 'Server error.', message: null });
    }
});

app.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/');
});

app.get('/create-offer', auth, (req, res) => {
    res.render('user/create-offer', { title: 'Create Offer' });
});

app.post('/carpools', auth, async (req, res) => {
    const { carName, location, time, price, gender, genderPreference, totalSeats } = req.body;
    try {
        const newCarpool = new Carpool({
            userId: res.locals.user.id,
            carName,
            location,
            time,
            price,
            gender,
            genderPreference: !!genderPreference,
            totalSeats,
            bookedSeats: 0
        });
        await newCarpool.save();
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error.');
    }
});

app.post('/carpools/:id/book', auth, async (req, res) => {
    try {
        const carpool = await Carpool.findById(req.params.id);
        if (!carpool) {
            return res.status(404).send('Carpool not found.');
        }
        if (carpool.bookedSeats >= carpool.totalSeats) {
            return res.status(400).send('No seats available.');
        }
        await Carpool.findByIdAndUpdate(req.params.id, { $inc: { bookedSeats: 1 } });
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error.');
    }
});

app.delete('/carpools/:id/delete', auth, async (req, res) => {
    try {
        const carpool = await Carpool.findById(req.params.id);
        if (!carpool) {
            return res.status(404).send('Carpool not found.');
        }
        if (carpool.userId.toString() !== req.user.id) {
            return res.status(403).send('Forbidden. You can only delete your own carpools.');
        }
        await carpool.deleteOne();
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error.');
    }
});

app.get('/chat/:carpoolId', auth, async (req, res) => {
    const Chat = require('./models/Chat');
    const messages = await Chat.find({ carpoolId: req.params.carpoolId }).populate('sender', 'name');
    res.render('chat/chat', { title: 'Chat', carpoolId: req.params.carpoolId, messages: messages });
});

// WebSocket logic for handling rooms
const chatRooms = new Map();

wss.on('connection', ws => {
    console.log('Client connected to WebSocket');
    ws.on('message', async message => {
        try {
            const data = JSON.parse(message);
            const carpoolId = data.carpoolId;
            const messageText = data.message;
            const userId = data.userId;

            if (data.type === 'join') {
                if (!chatRooms.has(carpoolId)) {
                    chatRooms.set(carpoolId, new Set());
                }
                chatRooms.get(carpoolId).add(ws);
                console.log(`Client joined room ${carpoolId}`);
                return;
            }

            if (data.type === 'chat' && carpoolId && messageText) {
                const Chat = require('./models/Chat');
                const newChatMessage = new Chat({
                    carpoolId: carpoolId,
                    sender: userId,
                    message: messageText,
                });
                await newChatMessage.save();

                const user = await User.findById(userId);
                const senderName = user ? user.name : 'Unknown';
                const formattedMessage = `${senderName}: ${messageText}`;

                if (chatRooms.has(carpoolId)) {
                    chatRooms.get(carpoolId).forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(formattedMessage);
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Failed to parse message or save to DB:', error);
        }
    });

    ws.on('close', () => {
        chatRooms.forEach(clients => clients.delete(ws));
        console.log('Client disconnected');
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));