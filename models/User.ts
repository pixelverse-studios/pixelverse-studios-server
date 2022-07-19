import { model, Schema } from 'mongoose'

const userSchema = new Schema({
    createdAt: { type: Date, default: Date.now },
    updatedAt: Date,
    email: { type: String, unqiue: true },
    firstName: String,
    lastName: String,
    password: String
})

export default model('User', userSchema)
