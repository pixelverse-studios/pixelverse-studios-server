const { gql } = require('apollo-server')

const typeDefs = gql`
    scalar Date

    enum ErrorTypes {
        badInput
        userExists
    }

    enum SuccessTypes {
        registered
    }

    type UserSuccess {
        id: ID!
        email: String!
        password: String!
        firstName: String
        lastName: String
        token: String
        passwordResetToken: String
        successType: SuccessTypes!
    }

    type InputFieldError {
        field: String!
        message: String!
    }

    type UserInputError {
        errorType: ErrorTypes!
        errors: [InputFieldError]
    }

    type UserInvalidError {
        errorType: ErrorTypes!
        message: String!
    }

    union UserResponse = UserSuccess | UserInputError | UserInvalidError

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

    type Client {
        id: ID!
        email: String!
        firstName: String!
        lastName: String!
        status: String!
        meetings: [Meeting]
        originalCostEstimate: Float
        updatedCostEstimate: Float
        project: ClientProject
    }

    type Query {
        # USERS
        getUser(email: String!): UserResponse
        getAllUsers: [UserResponse]
        getLoggedInUser: UserResponse!

        # CLIENTS
        getAllClients: [Client]
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
        addNewClient(eventUri: String!, inviteeUri: String!): Client!
    }
`

module.exports = typeDefs
