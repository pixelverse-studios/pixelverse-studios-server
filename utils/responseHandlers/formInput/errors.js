const FORM_ERROR = 'Errors'

module.exports = {
    badInput: errors => ({
        __typename: FORM_ERROR,
        type: 'badInput',
        errors
    })
}
