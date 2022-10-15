import getAllUsersEndpoint from './getAllUsersEndpoint.js'
import getUserProfileEndpoint from './getUserProfileEndpoint.js'
import userLoginEndpoint from './userLoginEndpoint.js'

export function initialize(app) {
    const API_PREFIX = '/api/user'

    app.get(`${API_PREFIX}/all`, getAllUsersEndpoint)
    app.get(`${API_PREFIX}/:user_id`, getUserProfileEndpoint)
    app.post(`${API_PREFIX}/login`, userLoginEndpoint)
}
