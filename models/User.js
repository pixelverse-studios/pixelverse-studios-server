const { model, Schema } = require('mongoose')

const userSchema = new Schema({
    email: { type: String, unqiue: true },
    firstName: String,
    lastName: String,
    password: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: Date,
    devHours: [
        {
            date: Date,
            hoursLogged: Number,
            project: String,
            projectPhase: String
        }
    ]
})

module.exports = model('User', userSchema)
