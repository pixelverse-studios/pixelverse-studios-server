import { UserInputError } from 'apollo-server'
// import fetch from 'node-fetch'
import axios from 'axios'

import Clients from '../../models/Clients'
import { dateScalar } from '../..'
import { validateNewClientFields } from '../../utils/validators/validate-clients'

const REQUESTED_INTRO = 'REQUESTED_INTRO'
const CONTACTED = 'CONTACTED'
const CONTACT_ESTABLISHED = 'CONTACT_ESTABLISHED'
const ACCEPTED = 'ACCEPTED'
const IN_DEVELOPMENT = 'IN_DEVELOPMENT'
const PROJECT_MAINTENANCE = 'PROJECT_MAINTENANCE'
const TERMINATED = 'TERMINATED'

export const ClientMutations = {
    async addNewClient(
        _: any,
        { eventUri, inviteeUri }: { eventUri: string; inviteeUri: string }
    ) {
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

            const { location, start_time, created_at } = eventData
            const { firstName, lastName, questions_and_answers, email } =
                inviteeData

            const existingClient = await Clients.find({ email })
            if (existingClient) {
                throw new UserInputError('Client Exists', {
                    errors: {
                        email: 'Client already exists. Direct them to the ongoing scheduling page.'
                    }
                })
            }

            const newClient = new Clients({
                email,
                firstName,
                lastName,
                introMeeting: {
                    location: location.type,
                    url: location.join_url,
                    created: new Date(created_at),
                    scheduledFor: new Date(start_time),
                    prepInfo: questions_and_answers
                },
                status: REQUESTED_INTRO
            })
            // trigger an email sent to the new client welcoming them and letting them know we got and confirmed their meeting request
            const savedClient: any = await newClient.save()
            return { ...savedClient._doc, id: savedClient._id }
        } catch (error: any) {
            return new Error(error)
        }
    }
}

export const ClientQueries = {
    async getAllClients(_: any, {}, context: any) {
        try {
            const clients = await Clients.find()
            return clients
        } catch (error: any) {
            console.log(error)
            throw new Error(error)
        }
    }
}
