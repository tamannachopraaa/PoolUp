const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Chat = require('../models/Chat');

// This route could be for initial chat room setup or history
router.get('/:carpoolId', auth, async (req, res) => {
    try {
        const messages = await Chat.find({ carpoolId: req.params.carpoolId }).populate('sender', 'name');
        res.status(200).send(messages);
    } catch (err) {
        res.status(500).send('Server error.');
    }
});

// Note: WebSocket logic is primarily in server.js for simplicity
// This route is for demonstration or API-based chat
router.post('/', auth, async (req, res) => {
    const { carpoolId, message } = req.body;
    try {
        const newChatMessage = new Chat({
            carpoolId,
            sender: req.user.id,
            message,
        });
        await newChatMessage.save();
        res.status(201).send(newChatMessage);
    } catch (err) {
        res.status(500).send('Server error.');
    }
});

module.exports = router;