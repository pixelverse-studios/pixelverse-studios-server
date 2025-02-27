import { COLUMNS, db, Tables } from '../lib/db'

const getWebsiteEmail = async (id: string) => {
    try {
        const { data, error } = await db
            .from(Tables.WEBSITES)
            .select(COLUMNS.CONTACT_EMAIL)
            .eq('id', id)
            .single()

        if (error) throw new Error(error.message)

        return data ?? ''
    } catch (error) {
        throw error
    }
}

const getWebsiteDetailsForEmail = async (id: string) => {
    try {
        const {
            data: { contact_email, title },
            error
        } = await db.from(Tables.WEBSITES).select().eq('id', id).single()

        if (error) throw new Error(error.message)

        return { contact_email, title }
    } catch (error) {
        throw error
    }
}

const websitesDB = {
    getWebsiteEmail,
    getWebsiteDetailsForEmail
}
export default websitesDB
