const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const sendAdminNotification = async (carpool) => {
    const mailOptions = {
        from: `"PoolUp Notification" <${process.env.EMAIL_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: 'New Carpool Offer Created',
        html: `
            <h3>New Carpool Details</h3>
            <p><strong>Car:</strong> ${carpool.carName}</p>
            <p><strong>From/To:</strong> ${carpool.location}</p>
            <p><strong>Time:</strong> ${carpool.time}</p>
            <p><strong>Price:</strong> ₹${carpool.price}</p>
            <p><strong>Seats Available:</strong> ${carpool.totalSeats}</p>
            <p><strong>Gender Pref:</strong> ${carpool.gender}</p>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Email sent to admin successfully');
    } catch (err) {
        console.error('Nodemailer Error:', err);
    }
};

module.exports = sendAdminNotification;