import { VALID_EMAIL } from '../regex'
import { dateScalar } from '../../'

// create validations for create new client
// figure out how to add array of errors to a GQL user input error
type NewClientFieldsType = {
    email: string | null
    firstName: string | null
    lastName: string | null
    introMeeting: {
        location: string | null
        url: string | null
        scheduledFor: typeof dateScalar | null
        prepInfo: any | null
    }
}
export const validateNewClientFields = ({
    email,
    firstName,
    lastName,
    introMeeting
}: NewClientFieldsType) => {
    const errors: { field: string; error: string }[] = []

    if (!email) {
        errors.push({ field: 'Email', error: 'Email is required' })
    } else if (email && !VALID_EMAIL.test(email)) {
        errors.push({ field: 'Email', error: 'Invalid email format' })
    }

    if (!firstName) {
        errors.push({ field: 'First Name', error: 'First Name is required' })
    }

    if (!lastName) {
        errors.push({ field: 'Last Name', error: 'Last Name is required' })
    }

    if (!introMeeting) {
        errors.push({
            field: 'Intro Meeting',
            error: 'Intro Meeting details are required'
        })
    }

    return {
        valid: errors?.length <= 0,
        errors
    }
}
