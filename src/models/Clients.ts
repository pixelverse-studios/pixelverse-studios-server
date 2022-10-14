import { model, Schema } from 'mongoose'

const clientsSchema = new Schema({
    email: { type: String, unqiue: true },
    firstName: String,
    lastName: String,
    status: String,
    meetings: [
        {
            location: String,
            url: String,
            created: { type: Date, default: Date.now },
            scheduledFor: Date,
            prepInfo: [
                {
                    question: String,
                    answer: String
                }
            ]
        }
    ],
    originalCostEstimate: Number,
    updatedCostEstimate: Number,
    project: {
        title: String,
        domain: String,
        externalDependencies: [String],
        hoursLogged: Number,
        notes: String,
        originalLaunchDate: Date,
        updatedLaunchDate: Date
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
})

export default model('Clients', clientsSchema)
