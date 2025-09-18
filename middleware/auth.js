const jwt = require('jsonwebtoken');

function auth(req, res, next) {
    const token = req.cookies.token;
    if (!token) {
        return res.redirect('/login');
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        res.locals.user = decoded; // Makes the user available to EJS templates
        next();
    } catch (ex) {
        res.clearCookie('token');
        return res.redirect('/login');
    }
}

function admin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).send('Forbidden. You do not have admin access.');
    }
}

module.exports = { auth, admin };