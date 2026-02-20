const express = require('express');
const router = express.Router();
const { auth, admin } = require('../middleware/auth');
const Carpool = require('../models/Carpool');
const sendAdminNotification = require('../utils/mailer');

/* ================= CREATE OFFER ================= */
router.post('/', auth, async (req, res) => {
    try {
        const { carName, location, time, price, gender, totalSeats } = req.body;

        const rideTime = new Date(time);
        if (rideTime <= new Date()) {
            return res.status(400).send('Ride time must be in future');
        }

        const carpool = await Carpool.create({
            userId: req.user.id,
            carName,
            location,
            time,
            price,
            gender,
            totalSeats,
            bookedSeats: 0,
            bookedBy: []
        });

        // Simply call the function here. 
        // No DB changes, just sending the 'carpool' object to the mailer.
        sendAdminNotification(carpool);

        res.redirect('/');   
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

// ... rest of your code stays exactly the same
/* ================= LIST ALL CARPOOLS ================= */
router.get('/', auth, async (req, res) => {
    try {
        const carpools = await Carpool.find()
            .populate('userId', 'name email')
            .populate('bookedBy.user', 'name');

        res.status(200).send(carpools);
    } catch (err) {
        res.status(500).send('Server error');
    }
});

/* ================= BOOK SEATS ================= */
router.post('/:id/book', auth, async (req, res) => {
    try {
        const seats = parseInt(req.body.seats || 1);
        const carpool = await Carpool.findById(req.params.id);

        if (!carpool) return res.status(404).send('Carpool not found');
        if (carpool.userId.equals(req.user.id)) {
            return res.status(400).send('Cannot book your own ride');
        }

        const available = carpool.totalSeats - carpool.bookedSeats;
        if (seats > available) {
            return res.status(400).send('Not enough seats');
        }

        await Carpool.findByIdAndUpdate(req.params.id, {
            $inc: { bookedSeats: seats },
            $push: { bookedBy: { user: req.user.id, seats } }
        });

        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

/* ================= CANCEL BOOKING ================= */
router.post('/:id/cancel', auth, async (req, res) => {
    try {
        const carpool = await Carpool.findById(req.params.id);
        if (!carpool) return res.redirect('/');

        const booking = carpool.bookedBy.find(
            b => String(b.user) === String(req.user.id)
        );

        if (!booking) return res.redirect('/');

        await Carpool.findByIdAndUpdate(req.params.id, {
            $inc: { bookedSeats: -booking.seats },
            $pull: { bookedBy: { user: req.user.id } }
        });

        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
});

/* ================= ADMIN DELETE ================= */
router.delete('/:id', auth, admin, async (req, res) => {
    try {
        const carpool = await Carpool.findByIdAndDelete(req.params.id);
        if (!carpool) return res.status(404).send('Not found');
        res.redirect('/admin/manage-offers');
    } catch (err) {
        res.status(500).send('Server error');
    }
});

module.exports = router;
