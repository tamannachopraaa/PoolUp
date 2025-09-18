const express = require('express');
const router = express.Router();
const { auth, admin } = require('../middleware/auth');
const Carpool = require('../models/Carpool');

// User creates a carpool offer
router.post('/', auth, async (req, res) => {
    const { carName, time, location, price, gender, genderPreference } = req.body;
    try {
        const newCarpool = new Carpool({
            userId: req.user.id,
            carName,
            time,
            location,
            price,
            gender,
            genderPreference,
        });
        await newCarpool.save();
        res.status(201).send(newCarpool);
    } catch (err) {
        res.status(500).send('Server error.');
    }
});

// Get all carpool offers (for users to view)
router.get('/', auth, async (req, res) => {
    try {
        const carpools = await Carpool.find().populate('userId', 'name');
        res.status(200).send(carpools);
    } catch (err) {
        res.status(500).send('Server error.');
    }
});

// Admin manages (deletes) carpool offers
router.delete('/:id', [auth, admin], async (req, res) => {
    try {
        const carpool = await Carpool.findByIdAndDelete(req.params.id);
        if (!carpool) return res.status(404).send('Carpool offer not found.');
        res.status(200).send('Carpool offer deleted successfully.');
    } catch (err) {
        res.status(500).send('Server error.');
    }
});

module.exports = router;