const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
    carpoolId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Carpool',
        required: true,
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    message: {
        type: String,
        required: true,
    },
    timestamp: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model('Chat', chatSchema);