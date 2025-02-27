import { COLUMNS, db, Tables } from '../lib/db'

export const getWebsiteEmail = async (id: string) => {
    try {
        const { data, error } = await db
            .from(Tables.WEBSITES)
            .select('contact_email')
            .eq('id', id)
            .single()

        if (error) throw new Error(error.message)

        return data?.contact_email ?? ''
    } catch (error) {
        throw error
    }
}

export const getWebsiteDetailsForEmail = async (id: string) => {
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
