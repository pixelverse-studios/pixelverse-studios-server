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

const getWebsiteDetailsForEmail = async (slug: string) => {
    try {
        const {
            data: { contact_email, title, id },
            error
        } = await db
            .from(Tables.WEBSITES)
            .select()
            .eq(COLUMNS.WEBSITE_SLUG, slug)
            .single()

        if (error) throw new Error(error.message)

        return { contact_email, title, id }
    } catch (error) {
        throw error
    }
}

const websitesDB = {
    getWebsiteEmail,
    getWebsiteDetailsForEmail
}
export default websitesDB
