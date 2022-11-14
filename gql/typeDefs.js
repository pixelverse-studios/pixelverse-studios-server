const { gql } = require('apollo-server')

const typeDefs = gql`
    scalar Date

    enum UserSuccessTypes {
        registered
        loggedIn
        fetchedUser
        allUsersFetched
    }

    enum ErrorTypes {
        # FORM
        badInput

        # USER
        userNotFound
        emailInUse
        invalidToken
        noUsersFound
        invalidCredentials
        matchingPasswords

        # CLIENT
        clientNotFound
        noClientsFound

        # GENERAL
        fetched
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

    type Errors {
        type: ErrorTypes
        message: String
        errors: [InputFieldError]
    }

    union UserResponse = UserSuccess | Errors

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

    union ClientResponse = ClientSuccess | Errors

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
        updatePassword(
            email: String!
            newPassword: String!
            token: String!
        ): UserResponse
        deleteUser(id: String!): [UserResponse]
        sendPasswordResetEmail(email: String!): UserResponse

        # CLIENTS
        addNewClient(eventUri: String!, inviteeUri: String!): ClientResponse!
    }
`

module.exports = typeDefs
