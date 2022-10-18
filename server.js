import express from 'express'
import mongoose from 'mongoose'
import bodyParser from 'body-parser'
import cors from 'cors'
import * as dotenv from 'dotenv'
dotenv.config()

import * as UserController from './server/controllers/users/index.js'
import * as ClientController from './server/controllers/clients/index.js'

const app = express()
app.use(express.json())
app.use(bodyParser.urlencoded({ extended: true }))
// app.use(cors)

UserController.initialize(app)
ClientController.initialize(app)

const start = async () => {
    try {
        mongoose.connect(process.env.MONGODB)
        app.listen(process.env.PORT, () => {
            console.log(`Server started on port ${process.env.PORT}`)
            console.log('mongoDB connected')
        })
    } catch (error) {
        console.error(error)
        process.exit(1)
    }
}

start()
