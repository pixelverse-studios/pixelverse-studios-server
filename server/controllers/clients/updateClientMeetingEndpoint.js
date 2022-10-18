import axios from 'axios'

import Clients from '../../models/Clients.js'
import { phases } from './utils.js'
import { handleInternalError } from '../../../utils/buildResponse.js'

export default async (req, res) => {
    try {
        const { eventUri, inviteeUri } = req.body
        const config = {
            headers: {
                Authorization: `Bearer ${process.env.CALENDLY_ACCESS_TOKEN}`,
                'X-TOKEN': process.env.CALENDLY_API_KEY
            }
        }

        const { data: eventData } = await axios.get(eventUri, config)
        const { data: inviteeData } = await axios.get(inviteeUri, config)

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
                    prepInfo: questions_and_answers
                }
            ]
            const updatedClient = await existingClient.save()
            return res.status(200).json({ data: updatedClient })
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
                    prepInfo: questions_and_answers
                }
            ],
            status: phases.PHASE_1
        })

        const savedClient = await newClient.save()
        return res.status(200).json({ data: savedClient })
    } catch (error) {
        // TODO FIGURE OUT HOW TO PROPERLY THROW ERRORS
        // return handleInternalError({ res, error })
        // throw error
        return res.status(500)
    }
}
