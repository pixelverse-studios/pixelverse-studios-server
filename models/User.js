const { model, Schema } = require('mongoose')

const userSchema = new Schema({
    email: { type: String, unqiue: true },
    firstName: String,
    lastName: String,
    password: String,
    passwordResetToken: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: Date
})

module.exports = model('User', userSchema)
