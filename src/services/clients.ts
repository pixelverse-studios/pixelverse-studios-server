import { COLUMNS, db, Tables } from '../lib/db'

export const getClientEmail = async (id: string) => {
    try {
        console.log('GET CLIENT EMAIL')
        const { data, error } = await db
            .from(Tables.CLIENTS)
            .select('email')
            .eq('id', id)
            .single()

        if (error) throw new Error(error.message)

        console.log(data)
    } catch (error) {
        throw error
    }
}
