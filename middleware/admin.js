function admin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).send('Forbidden. You do not have admin access.');
    }
}

module.exports = admin;