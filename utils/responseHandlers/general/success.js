const GENERAL_SUCCESS = 'GeneralSuccessTypes'

const baseResponse = (type, message) => ({
    __typename: GENERAL_SUCCESS,
    successType: type,
    message
})

module.exports = {
    fetched: () => baseResponse('fetched', 'Query fetched successfully')
}
