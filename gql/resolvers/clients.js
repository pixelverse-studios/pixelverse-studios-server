const axios = require('axios')
const { format } = require('date-fns')

const Clients = require('../../models/Clients')
const {
    sendIntroMeetingResponse
} = require('../../utils/mailer/clients/introMeetingResponse')
const buildResponse = require('../../utils/responseHandlers')
const { validateToken } = require('../../utils/token')

const phases = {
    PHASE_1: 'Phase 1: Information Gathering',
    PHASE_2: 'Phase 2: Structure & Design',
    PHASE_3: 'Phase 3: Initial Development',
    PHASE_4: 'Phase 4: Testing/QA',
    PHASE_5: 'Phase 5: Post Launch Maintenance'
}

module.exports.ClientMutations = {
    async addNewClient(_, { eventUri, inviteeUri }) {
        try {
            const authHeader = {
                headers: {
                    Authorization: `Bearer ${process.env.CALENDLY_ACCESS_TOKEN}`
                }
            }
            const { data: eventData } = await axios.get(eventUri, authHeader)
            const { data: inviteeData } = await axios.get(
                inviteeUri,
                authHeader
            )

            const { location, start_time, created_at } = eventData.resource
            const { first_name, last_name, questions_and_answers, email } =
                inviteeData.resource

            const existingClient = await Clients.findOne({ email })

            if (existingClient) {
                existingClient.meetings = [
                    ...existingClient.meetings,
                    {
                        location: location.type,
                        url: location.join_url,
                        created: new Date(created_at),
                        scheduledFor: new Date(start_time),
                        prepInfo: questions_and_answers,
                        notes: []
                    }
                ]
                const updatedClient = await existingClient.save()
                return buildResponse.client.success.clientUpdated(updatedClient)
            }

            const newClient = new Clients({
                email,
                firstName: first_name,
                lastName: last_name,
                meetings: [
                    {
                        location: location.type,
                        url: location.join_url,
                        created: new Date(created_at),
                        scheduledFor: new Date(start_time),
                        prepInfo: questions_and_answers,
                        notes: []
                    }
                ],
                status: phases.PHASE_1
            })
            // trigger an email sent to the new client welcoming them and letting them know we got and confirmed their meeting request
            const savedClient = await newClient.save()

            await sendIntroMeetingResponse(email, {
                location: location.type,
                dateTime: format(new Date(start_time), 'MM/dd h:m aaa')
            })
            return buildResponse.client.success.clientAdded(savedClient)
        } catch (error) {
            return new Error(error)
        }
    },
    async editClient(
        _,
        { email, status, originalCostEstimate, updatedCostEstimate, project },
        context
    ) {
        try {
            const token = validateToken(context)
            if (!token.valid) {
                return buildResponse.user.errors.invalidToken()
            }

            if (Object.values(phases).indexOf(status) < 0) {
                return buildResponse.form.errors.badInput([
                    {
                        field: 'Status',
                        message: 'Invalid client status provided'
                    }
                ])
            }

            const client = await Clients.findOne({ email })
            if (!client) {
                return buildResponse.client.errors.clientNotFound()
            }

            client.status = status ?? client.status
            client.originalCostEstimate =
                originalCostEstimate ?? client.originalCostEstimate
            client.updatedCostEstimate =
                updatedCostEstimate ?? client.updatedCostEstimate
            client.project = project ?? client.project

            await client.save()

            return buildResponse.client.success.clientUpdated(client)
        } catch (error) {
            throw new Error(error)
        }
    },
    async editClientNotes(_, { email, notes }, context) {
        try {
            if (!notes) {
                return buildResponse.form.errors.badInput([
                    {
                        field: 'Notes',
                        message: 'Notes are required'
                    }
                ])
            }

            const token = validateToken(context)
            if (!token.valid) {
                return buildResponse.user.errors.invalidToken()
            }

            const client = await Clients.findOne({ email })
            if (!client) {
                return buildResponse.client.errors.clientNotFound()
            }

            client.notes = notes
            await client.save()

            return buildResponse.client.success.clientUpdated(client)
        } catch (error) {
            throw new Error(error)
        }
    },
    async editClientMeetingNotes(_, { email, notes, meetingIndex }, context) {
        try {
            if (!notes) {
                return buildResponse.form.errors.badInput([
                    {
                        field: 'Notes',
                        message: 'Meeting notes are required'
                    }
                ])
            }

            const token = validateToken(context)
            if (!token.valid) {
                return buildResponse.user.errors.invalidToken()
            }

            const client = await Clients.findOne({ email })
            if (!client) {
                return buildResponse.client.errors.clientNotFound()
            }

            client.meetings[meetingIndex].notes = notes
            await client.save()

            return buildResponse.client.success.clientUpdated(client)
        } catch (error) {
            throw new Error(error)
        }
    }
}

module.exports.ClientQueries = {
    async getClient(_, { email }, context) {
        try {
            const token = validateToken(context)

            if (!token.valid) {
                return buildResponse.user.errors.invalidToken()
            }

            const client = await Clients.findOne({ email })
            if (client) {
                return buildResponse.client.success.clientFetched(client)
            }
        } catch (error) {
            throw new Error(error)
        }
    },
    async getAllClients(_, {}, context) {
        try {
            const token = validateToken(context)
            if (!token.valid) {
                return [buildResponse.user.errors.invalidToken()]
            }

            const clients = await Clients.find()
            if (clients?.length) {
                return buildResponse.client.success.allClientsFetched(clients)
            }

            return [buildResponse.client.errors.noClientsFound()]
        } catch (error) {
            throw new Error(error)
        }
    }
}
