import { COLUMNS, db, Tables } from '../lib/db'

const getAllContactFormSubmissions = async () => {
    try {
        const { data, error } = await db.from(Tables.CONTACT_FORMS).select()

        if (error) throw new Error(error.message)

        return data
    } catch (error) {
        throw error
    }
}

interface NewRecord {
    website_id: string
    payload: {
        fullname: string
        email: string
        phone: string
        additional: any
    }
}
const addFormSubmissionRecord = async ({ website_id, payload }: NewRecord) => {
    try {
        const { error } = await db
            .from(Tables.CONTACT_FORMS)
            .insert({
                website_id,
                fullname: payload.fullname,
                email: payload.email,
                phone: payload.phone,
                data: payload.additional
            })
            .select()

        if (error) {
            throw error
        }

        return
    } catch (error) {
        throw error
    }
}

const contactFormDB = {
    getAllContactFormSubmissions,
    addFormSubmissionRecord
}

export default contactFormDB
