import Clients from '../../models/Clients'

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
