import { model, Schema } from 'mongoose'

const clientsSchema = new Schema({
    email: { type: String, unqiue: true },
    password: String,
    firstName: String,
    lastName: String,
    status: String,
    introMeeting: {
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
    },
    followupMeetings: [
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
    finance: {
        hourly: String,
        totalEstimate: Number
    },
    project: {
        title: String,
        domain: String,
        externalDependencies: [String],
        hoursTracked: Number,
        notes: String
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: Date
})

export default model('Clients', clientsSchema)
