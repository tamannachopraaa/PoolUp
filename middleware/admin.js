// This file is a bit redundant as it's already defined within auth.js
// but here it is for clarity as a separate file as per your request.
function admin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).send('Forbidden. You do not have admin access.');
    }
}

module.exports = admin;