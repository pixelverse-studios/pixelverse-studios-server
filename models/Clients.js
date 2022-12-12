const { model, Schema } = require('mongoose')

const clientsSchema = new Schema({
    email: { type: String, unqiue: true },
    firstName: String,
    lastName: String,
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
            ],
            notes: [String]
        }
    ],
    project: {
        title: String,
        domain: String,
        externalDependencies: [String],
        phases: [
            {
                originalCostEstimate: Number,
                updatedCostEstimate: Number,
                originalLaunchDate: Date,
                updatedLaunchDate: Date,
                status: String,
                notes: [String],
                amountPaid: Number
            }
        ]
    },
    notes: [String],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
})

module.exports = model('Clients', clientsSchema)
