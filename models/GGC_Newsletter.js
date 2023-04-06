const { model, Schema } = require('mongoose')

const GgcNewsLetter = new Schema({
    email: { type: String, unqiue: true },
    // firstName: String,
    // lastName: String,
    name: String,
    subscribed: Boolean,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
})

module.exports = model('GgcNewsletter', GgcNewsLetter)
