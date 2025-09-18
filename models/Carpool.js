const mongoose = require('mongoose');

const carpoolSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    carName: {
        type: String,
        required: true,
    },
    location: {
        type: String,
        required: true,
    },
    time: {
        type: String,
        required: true,
    },
    price: {
        type: Number,
        required: true,
    },
    gender: {
        type: String,
        enum: ['male', 'female'],
        required: true,
    },
    genderPreference: {
        type: Boolean,
        default: false,
    },
    // New fields for seat management
    totalSeats: {
        type: Number,
        required: true,
        default: 1
    },
    bookedSeats: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model('Carpool', carpoolSchema);