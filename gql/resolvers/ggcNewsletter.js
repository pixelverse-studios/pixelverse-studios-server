const axios = require('axios')

const GgcNewsLetter = require('../../models/GGC_Newsletter')
const buildResponse = require('../../utils/responseHandlers')

const getAllParticipants = async () => {
    try {
        return await GgcNewsLetter.find()
    } catch (error) {
        throw error
    }
}

const getSubscribedParticipants = async () => {
    try {
        return await GgcNewsLetter.find({
            subscribed: true
        })
    } catch (error) {
        throw error
    }
}

module.exports.NewsletterMutations = {
    async addNewsletterParticipant(_, { email, name }) {
        if (!email) {
            return buildResponse.form.badInput([
                {
                    field: 'Email',
                    message: 'Email is required'
                }
            ])
        }
        try {
            const isUserSubscribed = await GgcNewsLetter.findOne({ email })
            if (isUserSubscribed) {
                return {
                    __typename: 'Errors',
                    type: 'emailInUse',
                    message: 'You are already subscribed.'
                }
            }

            const newSubscriber = new GgcNewsLetter({
                email,
                name,
                subscribed: true
            })
            const saved = await newSubscriber.save()
            return { __typename: 'NewsletterSuccess', ...saved._doc }
        } catch (error) {
            throw error
        }
    },
    async addCalendlyParticipant(_, { inviteeUri }) {
        try {
            const authHeader = {
                headers: {
                    Authorization: `Bearer eyJraWQiOiIxY2UxZTEzNjE3ZGNmNzY2YjNjZWJjY2Y4ZGM1YmFmYThhNjVlNjg0MDIzZjdjMzJiZTgzNDliMjM4MDEzNWI0IiwidHlwIjoiUEFUIiwiYWxnIjoiRVMyNTYifQ.eyJpc3MiOiJodHRwczovL2F1dGguY2FsZW5kbHkuY29tIiwiaWF0IjoxNjgwNDUyNjUyLCJqdGkiOiI3Mjk1NjYyMC1mNGI0LTRhNmEtOGUwYS1iN2ZlZGRhMTEwZWMiLCJ1c2VyX3V1aWQiOiIyNDZlMzhlMC1jY2NiLTRjMjQtOWY1OS0zNjQ0ZTY2OTAzMzUifQ.fkqqLPkSK3VCN_-MmJwTYocVQsQ4rcblbT-uDI73PIZ55yEOCB7iYARAGlYaHB9G4aGQ7VJCzl9p3diRzcWLAg `
                }
            }
            const { data: inviteeData } = await axios.get(
                inviteeUri,
                authHeader
            )
            const { name, email } = inviteeData.resource

            const existingClient = await GgcNewsLetter.findOne({ email })

            if (existingClient) {
                return {
                    __typename: 'Errors',
                    type: 'emailInUse',
                    message: 'You are already subscribed.'
                }
            }

            const newSubscriber = new GgcNewsLetter({
                email,
                name,
                subscribed: true
            })
            const saved = await newSubscriber.save()
            return { __typename: 'NewsletterSuccess', ...saved }
        } catch (error) {
            return new Error(error)
        }
    }
}

module.exports.NewsletterQueries = {
    async getSubscribedNewsletterUsers() {
        try {
            const subscribedUsers = await getSubscribedParticipants()
            return {
                __typename: 'MultiNewsletterSuccess',
                users: subscribedUsers
            }
            // return buildResponse.newsletter.success.usersFetched(
            //     subscribedUsers
            // )
        } catch (error) {
            throw error
        }
    },
    async getAllNewsletterUsers() {
        try {
            const allUsers = await getAllParticipants()
            return {
                __typename: 'MultiNewsletterSuccess',
                users: allUsers
            }
            return buildResponse.newsletter.success.usersFetched(allUsers)
        } catch (error) {
            throw error
        }
    }
}
