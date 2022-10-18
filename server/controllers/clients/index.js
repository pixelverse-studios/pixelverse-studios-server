import GetClientsEndpoint from './getClientsEndpoint.js'
import UpdateClientMeetingEndpoint from './updateClientMeetingEndpoint.js'

export function initialize(app) {
    const API_VERSION = 'v1'
    const API_PREFIX = `/api/${API_VERSION}/clients`

    app.get(`${API_PREFIX}`, GetClientsEndpoint)
    app.post(`${API_PREFIX}`, UpdateClientMeetingEndpoint)
}
