const mongoose = require('mongoose');
// Define the Carpool Schema
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
        enum: ['any', 'male', 'female'],
        required: true,
    },
    totalSeats: {
        type: Number,
        required: true,
    },
    bookedSeats: {
        type: Number,
        default: 0
    },
    // This new field will store the users who have booked a seat
    bookedBy: [{
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    seats: {
        type: Number,
        required: true,
        default: 1,
        min: 1
    }
}]
}, {
    // This automatically adds `createdAt` and `updatedAt` fields
    timestamps: true 
});

module.exports = mongoose.model('Carpool', carpoolSchema);
