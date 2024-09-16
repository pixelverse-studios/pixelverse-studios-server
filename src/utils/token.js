const jwt = require('jsonwebtoken')

module.exports.generateToken = user => {
    const userData = {
        _id: user._id,
        email: user.email
    }

    return jwt.sign({ ...userData }, process.env?.TOKEN_SECRET ?? '', {
        expiresIn: process.env?.TOKEN_EXPIRE ?? '24hr'
    })
}

module.exports.generateResetPwToken = user => {
    const userData = {
        id: user._id,
        email: user.email
    }

    return jwt.sign({ ...userData }, process.env?.TOKEN_SECRET ?? '', {
        expiresIn: '1hr'
    })
}

const isTokenExpired = expiration => {
    if (expiration * 1000 < Date.now()) return false

    return true
}
module.exports.isTokenExpired = isTokenExpired

module.exports.validateToken = context => {
    const { user } = context
    if (!user) {
        return {
            valid: false,
            user
        }
    }

    return {
        valid: isTokenExpired(user.exp),
        user
    }
}
