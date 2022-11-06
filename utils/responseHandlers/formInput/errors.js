const FORM_ERROR = 'FormInputError'

module.exports = {
    badInput: errors => ({
        __typename: FORM_ERROR,
        formErrorType: 'badInput',
        errors
    })
}
