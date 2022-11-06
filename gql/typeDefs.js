const { gql } = require('apollo-server')

const typeDefs = gql`
    scalar Date

    enum UserSuccessTypes {
        registered
        loggedIn
        fetchedUser
        allUsersFetched
    }

    enum UserErrorTypes {
        userNotFound
        emailInUse
        invalidToken
        noUsersFound
        invalidCredentials
    }

    enum GeneralSuccessTypes {
        fetched
    }

    enum GeneralErrorTypes {
        badInput
    }

    type UserSuccess {
        _id: ID!
        email: String!
        password: String!
        firstName: String
        lastName: String
        token: String
        passwordResetToken: String
        successType: UserSuccessTypes!
    }

    type InputFieldError {
        field: String!
        message: String!
    }

    type FormInputError {
        formErrorType: GeneralErrorTypes!
        errors: [InputFieldError]
    }

    type GeneralErrors {
        generalErrorType: GeneralErrorTypes!
        message: String!
    }

    type UserErrors {
        userErrorType: UserErrorTypes!
        message: String!
    }

    union UserResponse =
          UserSuccess
        | FormInputError
        | UserErrors
        | GeneralErrors

    type MeetingPrepInfo {
        answer: String
        question: String
    }

    type Meeting {
        location: String
        url: String
        scheduledFor: Date
        prepInfo: [MeetingPrepInfo]
    }

    type Finances {
        hourly: String
        totalEstimate: Float
    }

    type ClientProject {
        title: String
        domain: String
        externalDependencies: [String]
        hoursLogged: Float
        notes: String
        originalLaunchDate: Date
        updatedLaunchDate: Date
    }

    enum ClientSuccessTypes {
        clientAdded
        clientUpdated
        allClientsFetched
    }

    enum ClientErrorTypes {
        clientNotFound
        noClientsFound
    }

    type ClientSuccess {
        _id: ID!
        email: String!
        firstName: String!
        lastName: String!
        status: String!
        meetings: [Meeting]
        originalCostEstimate: Float
        updatedCostEstimate: Float
        project: ClientProject
        successType: ClientSuccessTypes!
    }

    type ClientErrors {
        clientErrorType: ClientErrorTypes!
        message: String!
    }

    union ClientResponse =
          ClientSuccess
        | FormInputError
        | GeneralErrors
        | ClientErrors

    type Query {
        # USERS
        getUser(email: String!): UserResponse!
        getAllUsers: [UserResponse]
        getLoggedInUser: UserResponse!

        # CLIENTS
        getAllClients: [ClientResponse]
    }

    type Mutation {
        # USERS
        register(
            email: String!
            password: String!
            firstName: String!
            lastName: String!
        ): UserResponse
        login(email: String!, password: String!): UserResponse
        updateUser(
            firstName: String
            lastName: String
            email: String!
        ): UserResponse
        updatePassword(email: String!, newPassword: String!): UserResponse
        deleteUser(id: String!): [UserResponse]
        sendPasswordResetEmail(email: String!): [UserResponse]

        # CLIENTS
        addNewClient(eventUri: String!, inviteeUri: String!): ClientResponse!
    }
`

module.exports = typeDefs
